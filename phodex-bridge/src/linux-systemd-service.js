// FILE: linux-systemd-service.js
// Purpose: Owns Linux user-systemd helpers for the background Remodex bridge.
// Layer: CLI helper
// Exports: start/stop/status helpers plus the service runner used by `remodex up`.
// Depends on: child_process, fs, os, path, ./bridge, ./daemon-state, ./qr, ./secure-device-state

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startBridge } = require("./bridge");
const { readBridgeConfig } = require("./codex-desktop-refresher");
const { printQR } = require("./qr");
const { resetBridgeDeviceState } = require("./secure-device-state");
const {
  clearBridgeStatus,
  clearPairingSession,
  ensureRemodexLogsDir,
  ensureRemodexStateDir,
  readBridgeStatus,
  readDaemonConfig,
  readPairingSession,
  resolveBridgeStderrLogPath,
  resolveBridgeStdoutLogPath,
  resolveRemodexStateDir,
  writeBridgeStatus,
  writeDaemonConfig,
  writePairingSession,
} = require("./daemon-state");
const { mergeBridgeStatusForDaemon } = require("./macos-launch-agent");

const SERVICE_NAME = "remodex-bridge.service";
const DEFAULT_PAIRING_WAIT_TIMEOUT_MS = 10_000;
const DEFAULT_PAIRING_WAIT_INTERVAL_MS = 200;

function runLinuxBridgeService({ env = process.env } = {}) {
  assertLinuxPlatform();
  const config = readDaemonConfig({ env });
  if (!config?.relayUrl) {
    const message = "No relay URL configured for the Linux bridge service.";
    clearPairingSession({ env });
    writeBridgeStatus({
      state: "error",
      connectionStatus: "error",
      pid: process.pid,
      lastError: message,
    }, { env });
    console.error(`[remodex] ${message}`);
    return;
  }

  startBridge({
    config,
    printPairingQr: false,
    onPairingSession(pairingSession) {
      writePairingSession(pairingSession, { env });
    },
    onBridgeStatus(status) {
      writeBridgeStatus(
        mergeBridgeStatusForDaemon(status, readBridgeStatus({ env })),
        { env }
      );
    },
  });
}

async function startLinuxBridgeService({
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  execFileSyncImpl = execFileSync,
  osImpl = os,
  nodePath = process.execPath,
  cliPath = path.resolve(__dirname, "..", "bin", "remodex.js"),
  waitForPairing = false,
  pairingTimeoutMs = DEFAULT_PAIRING_WAIT_TIMEOUT_MS,
  pairingPollIntervalMs = DEFAULT_PAIRING_WAIT_INTERVAL_MS,
} = {}) {
  assertLinuxPlatform(platform);
  const config = readBridgeConfig({ env, platform, fsImpl });
  assertRelayConfigured(config);
  const startedAt = Date.now();

  writeDaemonConfig(config, { env, fsImpl });
  clearPairingSession({ env, fsImpl });
  clearBridgeStatus({ env, fsImpl });
  ensureRemodexStateDir({ env, fsImpl, osImpl });
  ensureRemodexLogsDir({ env, fsImpl, osImpl });

  const unitPath = writeSystemdUserUnit({
    env,
    fsImpl,
    osImpl,
    nodePath,
    cliPath,
  });
  restartSystemdUserService({
    execFileSyncImpl,
  });

  if (!waitForPairing) {
    return {
      unitPath,
      pairingSession: null,
    };
  }

  const pairingSession = await waitForFreshPairingSession({
    env,
    fsImpl,
    startedAt,
    timeoutMs: pairingTimeoutMs,
    intervalMs: pairingPollIntervalMs,
  });
  return {
    unitPath,
    pairingSession,
  };
}

function stopLinuxBridgeService({
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  env = process.env,
} = {}) {
  assertLinuxPlatform(platform);
  try {
    execFileSyncImpl("systemctl", ["--user", "disable", "--now", SERVICE_NAME], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    if (!isMissingSystemdServiceError(error)) {
      throw error;
    }
  }
  clearPairingSession({ env, fsImpl });
  clearBridgeStatus({ env, fsImpl });
}

function resetLinuxBridgePairing({
  env = process.env,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  resetBridgePairingImpl = resetBridgeDeviceState,
} = {}) {
  assertLinuxPlatform(platform);
  stopLinuxBridgeService({
    env,
    platform,
    execFileSyncImpl,
    fsImpl,
  });
  return resetBridgePairingImpl();
}

function getLinuxBridgeServiceStatus({
  env = process.env,
  platform = process.platform,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  osImpl = os,
} = {}) {
  assertLinuxPlatform(platform);
  const systemd = readSystemdUserServiceState({ execFileSyncImpl });
  return {
    serviceName: SERVICE_NAME,
    platform: "linux",
    installed: fsImpl.existsSync(resolveSystemdUserUnitPath({ env, osImpl })),
    systemdActive: systemd.active,
    systemdSubState: systemd.subState,
    systemdPid: systemd.pid,
    daemonConfig: readDaemonConfig({ env, fsImpl, osImpl }),
    bridgeStatus: readBridgeStatus({ env, fsImpl, osImpl }),
    pairingSession: readPairingSession({ env, fsImpl, osImpl }),
    unitPath: resolveSystemdUserUnitPath({ env, osImpl }),
    stdoutLogPath: resolveBridgeStdoutLogPath({ env, osImpl }),
    stderrLogPath: resolveBridgeStderrLogPath({ env, osImpl }),
  };
}

function printLinuxBridgeServiceStatus(options = {}) {
  const status = getLinuxBridgeServiceStatus(options);
  const bridgeState = status.bridgeStatus?.state || "unknown";
  const connectionStatus = status.bridgeStatus?.connectionStatus || "unknown";
  const pairingCreatedAt = status.pairingSession?.createdAt || "none";
  console.log(`[remodex] Service name: ${status.serviceName}`);
  console.log(`[remodex] Installed: ${status.installed ? "yes" : "no"}`);
  console.log(`[remodex] Systemd active: ${status.systemdActive || "unknown"}`);
  console.log(`[remodex] Systemd substate: ${status.systemdSubState || "unknown"}`);
  console.log(`[remodex] PID: ${status.systemdPid || status.bridgeStatus?.pid || "unknown"}`);
  console.log(`[remodex] Bridge state: ${bridgeState}`);
  console.log(`[remodex] Connection: ${connectionStatus}`);
  console.log(`[remodex] Pairing payload: ${pairingCreatedAt}`);
  console.log(`[remodex] Unit: ${status.unitPath}`);
  console.log(`[remodex] Stdout log: ${status.stdoutLogPath}`);
  console.log(`[remodex] Stderr log: ${status.stderrLogPath}`);
}

function printLinuxBridgePairingQr({ pairingSession = null, env = process.env, fsImpl = fs } = {}) {
  const nextPairingSession = pairingSession || readPairingSession({ env, fsImpl });
  const pairingPayload = nextPairingSession?.pairingPayload;
  if (!pairingPayload) {
    throw new Error("The Linux bridge service did not publish a pairing payload yet.");
  }

  printQR(nextPairingSession);
}

function writeSystemdUserUnit({
  env = process.env,
  fsImpl = fs,
  osImpl = os,
  nodePath = process.execPath,
  cliPath = path.resolve(__dirname, "..", "bin", "remodex.js"),
} = {}) {
  const unitPath = resolveSystemdUserUnitPath({ env, osImpl });
  const serialized = buildSystemdUserUnit({
    homeDir: env.HOME || osImpl.homedir(),
    pathEnv: env.PATH || "",
    stateDir: resolveRemodexStateDir({ env, osImpl }),
    stdoutLogPath: resolveBridgeStdoutLogPath({ env }),
    stderrLogPath: resolveBridgeStderrLogPath({ env }),
    nodePath,
    cliPath,
  });

  fsImpl.mkdirSync(path.dirname(unitPath), { recursive: true });
  fsImpl.writeFileSync(unitPath, serialized, "utf8");
  return unitPath;
}

function buildSystemdUserUnit({
  homeDir,
  pathEnv,
  stateDir,
  stdoutLogPath,
  stderrLogPath,
  nodePath,
  cliPath,
}) {
  return `[Unit]
Description=Remodex bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${quoteSystemdCommandArg(nodePath)} ${quoteSystemdCommandArg(cliPath)} run-service
Restart=always
RestartSec=2
WorkingDirectory=${homeDir}
Environment=${quoteSystemdValue(`HOME=${homeDir}`)} ${quoteSystemdValue(`PATH=${pathEnv}`)} ${quoteSystemdValue(`REMODEX_DEVICE_STATE_DIR=${stateDir}`)}
StandardOutput=append:${stdoutLogPath}
StandardError=append:${stderrLogPath}

[Install]
WantedBy=default.target
`;
}

async function waitForFreshPairingSession({
  env = process.env,
  fsImpl = fs,
  startedAt = Date.now(),
  timeoutMs = DEFAULT_PAIRING_WAIT_TIMEOUT_MS,
  intervalMs = DEFAULT_PAIRING_WAIT_INTERVAL_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const pairingSession = readPairingSession({ env, fsImpl });
    const createdAt = Date.parse(pairingSession?.createdAt || "");
    if (pairingSession?.pairingPayload && Number.isFinite(createdAt) && createdAt >= startedAt) {
      return pairingSession;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for the Linux bridge service to publish a pairing QR. `
    + `Check ${resolveBridgeStderrLogPath({ env })} or run \`journalctl --user -u ${SERVICE_NAME}\`.`
  );
}

function restartSystemdUserService({
  execFileSyncImpl = execFileSync,
} = {}) {
  execFileSyncImpl("systemctl", ["--user", "daemon-reload"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSyncImpl("systemctl", ["--user", "enable", "--now", SERVICE_NAME], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSyncImpl("systemctl", ["--user", "restart", SERVICE_NAME], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function readSystemdUserServiceState({
  execFileSyncImpl = execFileSync,
} = {}) {
  try {
    const output = execFileSyncImpl("systemctl", [
      "--user",
      "show",
      SERVICE_NAME,
      "--property=ActiveState,SubState,MainPID",
      "--no-page",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const fields = parseSystemdShow(output);
    const pid = Number.parseInt(fields.MainPID || "", 10);
    return {
      active: fields.ActiveState || "unknown",
      subState: fields.SubState || "unknown",
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      raw: output,
    };
  } catch (error) {
    if (isMissingSystemdServiceError(error)) {
      return {
        active: "inactive",
        subState: "not-found",
        pid: null,
        raw: "",
      };
    }
    throw error;
  }
}

function parseSystemdShow(output) {
  const fields = {};
  for (const line of String(output || "").split("\n")) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    fields[line.slice(0, index)] = line.slice(index + 1);
  }
  return fields;
}

function resolveSystemdUserUnitPath({ env = process.env, osImpl = os } = {}) {
  const configHome = normalizeNonEmptyString(env.XDG_CONFIG_HOME)
    || path.join(env.HOME || osImpl.homedir(), ".config");
  return path.join(configHome, "systemd", "user", SERVICE_NAME);
}

function assertLinuxPlatform(platform = process.platform) {
  if (platform !== "linux") {
    throw new Error("Linux bridge service management is only available on Linux.");
  }
}

function assertRelayConfigured(config) {
  if (typeof config?.relayUrl === "string" && config.relayUrl.trim()) {
    return;
  }
  throw new Error("No relay URL configured. Run ./run-local-remodex.sh or set REMODEX_RELAY before enabling the Linux bridge service.");
}

function isMissingSystemdServiceError(error) {
  const combined = [
    error?.message,
    error?.stderr?.toString?.("utf8"),
    error?.stdout?.toString?.("utf8"),
  ].filter(Boolean).join("\n").toLowerCase();
  return combined.includes("not loaded")
    || combined.includes("could not be found")
    || combined.includes("not-found")
    || combined.includes("no such file")
    || combined.includes("does not exist");
}

function quoteSystemdCommandArg(value) {
  return quoteSystemdValue(value);
}

function quoteSystemdValue(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  buildSystemdUserUnit,
  getLinuxBridgeServiceStatus,
  printLinuxBridgePairingQr,
  printLinuxBridgeServiceStatus,
  resetLinuxBridgePairing,
  resolveSystemdUserUnitPath,
  runLinuxBridgeService,
  startLinuxBridgeService,
  stopLinuxBridgeService,
};
