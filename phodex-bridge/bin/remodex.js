#!/usr/bin/env node
// FILE: remodex.js
// Purpose: CLI surface for foreground bridge runs, pairing reset, thread resume, and macOS service control.
// Layer: CLI binary
// Exports: none
// Depends on: ../src

const {
  getLinuxBridgeServiceStatus,
  getMacOSBridgeServiceStatus,
  printLinuxBridgePairingQr,
  printLinuxBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  resetLinuxBridgePairing,
  resetMacOSBridgePairing,
  runLinuxBridgeService,
  runMacOSBridgeService,
  startBridge,
  startLinuxBridgeService,
  startMacOSBridgeService,
  stopLinuxBridgeService,
  stopMacOSBridgeService,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
} = require("../src");
const { version } = require("../package.json");

const defaultDeps = {
  getLinuxBridgeServiceStatus,
  getMacOSBridgeServiceStatus,
  printLinuxBridgePairingQr,
  printLinuxBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  resetLinuxBridgePairing,
  resetMacOSBridgePairing,
  runLinuxBridgeService,
  runMacOSBridgeService,
  startBridge,
  startLinuxBridgeService,
  startMacOSBridgeService,
  stopLinuxBridgeService,
  stopMacOSBridgeService,
  resetBridgePairing,
  openLastActiveThread,
  watchThreadRollout,
};

if (require.main === module) {
  void main();
}

// ─── ENTRY POINT ─────────────────────────────────────────────

async function main({
  argv = process.argv,
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
  deps = defaultDeps,
} = {}) {
  const { command, jsonOutput, watchThreadId } = parseCliArgs(argv.slice(2));

  if (isVersionCommand(command)) {
    emitVersion({ jsonOutput, consoleImpl });
    return;
  }

  if (command === "up") {
    if (platform === "darwin") {
      const result = await deps.startMacOSBridgeService({
        waitForPairing: true,
      });
      deps.printMacOSBridgePairingQr({
        pairingSession: result.pairingSession,
      });
      return;
    }

    if (platform === "linux") {
      try {
        const result = await deps.startLinuxBridgeService({
          waitForPairing: true,
        });
        deps.printLinuxBridgePairingQr({
          pairingSession: result.pairingSession,
        });
      } catch (error) {
        if (!isLinuxSystemdUnavailableError(error)) {
          throw error;
        }
        const warn = typeof consoleImpl.warn === "function"
          ? consoleImpl.warn.bind(consoleImpl)
          : consoleImpl.log.bind(consoleImpl);
        warn("[remodex] Linux user systemd is unavailable; running the bridge in the foreground.");
        deps.startBridge();
      }
      return;
    }

    deps.startBridge();
    return;
  }

  if (command === "run") {
    deps.startBridge();
    return;
  }

  if (command === "run-service") {
    if (platform === "darwin") {
      deps.runMacOSBridgeService();
      return;
    }
    if (platform === "linux") {
      deps.runLinuxBridgeService();
      return;
    }
    assertServiceCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    return;
  }

  if (command === "start") {
    assertServiceCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = platform === "linux"
      ? await deps.startLinuxBridgeService({
        waitForPairing: false,
      })
      : await deps.startMacOSBridgeService({
        waitForPairing: false,
      });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        unitPath: result?.unitPath,
        pairingSession: result?.pairingSession,
      },
      message: platform === "linux"
        ? "[remodex] Linux bridge service is running."
        : "[remodex] macOS bridge service is running.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "restart") {
    assertServiceCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    deps.readBridgeConfig();
    const result = platform === "linux"
      ? await deps.startLinuxBridgeService({
        waitForPairing: false,
      })
      : await deps.startMacOSBridgeService({
        waitForPairing: false,
      });
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
        plistPath: result?.plistPath,
        unitPath: result?.unitPath,
        pairingSession: result?.pairingSession,
      },
      message: platform === "linux"
        ? "[remodex] Linux bridge service restarted."
        : "[remodex] macOS bridge service restarted.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "stop") {
    assertServiceCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    if (platform === "linux") {
      deps.stopLinuxBridgeService();
    } else {
      deps.stopMacOSBridgeService();
    }
    emitResult({
      payload: {
        ok: true,
        currentVersion: version,
      },
      message: platform === "linux"
        ? "[remodex] Linux bridge service stopped."
        : "[remodex] macOS bridge service stopped.",
      jsonOutput,
      consoleImpl,
    });
    return;
  }

  if (command === "status") {
    assertServiceCommand(command, {
      platform,
      consoleImpl,
      exitImpl,
    });
    if (jsonOutput) {
      emitJson({
        ...(platform === "linux"
          ? deps.getLinuxBridgeServiceStatus()
          : deps.getMacOSBridgeServiceStatus()),
        currentVersion: version,
      });
      return;
    }
    if (platform === "linux") {
      deps.printLinuxBridgeServiceStatus();
    } else {
      deps.printMacOSBridgeServiceStatus();
    }
    return;
  }

  if (command === "reset-pairing") {
    try {
      if (platform === "darwin") {
        deps.resetMacOSBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform: "darwin",
          },
          message: "[remodex] Stopped the macOS bridge service and cleared the saved pairing state. Run `remodex up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      } else if (platform === "linux") {
        deps.resetLinuxBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform: "linux",
          },
          message: "[remodex] Stopped the Linux bridge service and cleared the saved pairing state. Run `remodex up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      } else {
        deps.resetBridgePairing();
        emitResult({
          payload: {
            ok: true,
            currentVersion: version,
            platform,
          },
          message: "[remodex] Cleared the saved pairing state. Run `remodex up` to pair again.",
          jsonOutput,
          consoleImpl,
        });
      }
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to clear the saved pairing state."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "resume") {
    try {
      const state = deps.openLastActiveThread();
      emitResult({
        payload: {
          ok: true,
          currentVersion: version,
          threadId: state.threadId,
          source: state.source || "unknown",
        },
        message: `[remodex] Opened last active thread: ${state.threadId} (${state.source || "unknown"})`,
        jsonOutput,
        consoleImpl,
      });
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to reopen the last thread."}`);
      exitImpl(1);
    }
    return;
  }

  if (command === "watch") {
    try {
      deps.watchThreadRollout(watchThreadId);
    } catch (error) {
      consoleImpl.error(`[remodex] ${(error && error.message) || "Failed to watch the thread rollout."}`);
      exitImpl(1);
    }
    return;
  }

  consoleImpl.error(`Unknown command: ${command}`);
  consoleImpl.error(
    "Usage: remodex up | remodex run | remodex start | remodex restart | remodex stop | remodex status | "
    + "remodex reset-pairing | remodex resume | remodex watch [threadId] | remodex --version | "
    + "append --json to start/restart/stop/status/reset-pairing/resume for machine-readable output"
  );
  exitImpl(1);
}

function parseCliArgs(rawArgs) {
  const positionals = [];
  let jsonOutput = false;

  for (const arg of rawArgs) {
    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0] || "up",
    jsonOutput,
    watchThreadId: positionals[1] || "",
  };
}

function emitVersion({
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson({
      currentVersion: version,
    });
    return;
  }

  consoleImpl.log(version);
}

function emitResult({
  payload,
  message,
  jsonOutput = false,
  consoleImpl = console,
} = {}) {
  if (jsonOutput) {
    emitJson(payload);
    return;
  }

  consoleImpl.log(message);
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function assertServiceCommand(name, {
  platform = process.platform,
  consoleImpl = console,
  exitImpl = process.exit,
} = {}) {
  if (platform === "darwin" || platform === "linux") {
    return;
  }

  consoleImpl.error(`[remodex] \`${name}\` is only available on macOS or Linux. Use \`remodex up\` or \`remodex run\` for the foreground bridge on this OS.`);
  exitImpl(1);
}

function isVersionCommand(value) {
  return value === "-v" || value === "--v" || value === "-V" || value === "--version" || value === "version";
}

function isLinuxSystemdUnavailableError(error) {
  if (!error) {
    return false;
  }

  const stderr = Buffer.isBuffer(error.stderr)
    ? error.stderr.toString("utf8")
    : String(error.stderr || "");
  const message = String(error.message || "");
  const combined = `${message}\n${stderr}`.toLowerCase();

  return (
    error.code === "ENOENT" && combined.includes("systemctl")
  ) || (
    combined.includes("systemctl")
    && (
      combined.includes("failed to connect to bus")
      || combined.includes("no medium found")
      || combined.includes("system has not been booted with systemd")
      || combined.includes("not booted with systemd")
    )
  );
}

module.exports = {
  isLinuxSystemdUnavailableError,
  isVersionCommand,
  main,
};
