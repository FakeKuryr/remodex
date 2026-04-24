// FILE: remodex-cli.test.js
// Purpose: Verifies the public CLI exposes version, service control, and machine-readable status output.
// Layer: Integration-lite test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, child_process, path, ../package.json, ../bin/remodex

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const path = require("path");
const { version } = require("../package.json");
const { main } = require("../bin/remodex");

test("remodex --version prints the package version", () => {
  const cliPath = path.join(__dirname, "..", "bin", "remodex.js");
  const output = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  }).trim();

  assert.equal(output, version);
});

test("remodex restart reuses the macOS service start flow", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "remodex", "restart"],
    platform: "darwin",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      readBridgeConfig() {
        calls.push("read-config");
      },
      async startMacOSBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          plistPath: "/tmp/remodex.plist",
          pairingSession: { relay: "ws://127.0.0.1:9000/relay" },
        };
      },
    },
  });

  assert.deepEqual(calls, [
    "read-config",
    ["start-service", { waitForPairing: false }],
  ]);
  assert.deepEqual(messages, [
    "[remodex] macOS bridge service restarted.",
  ]);
});

test("remodex restart uses the Linux systemd service flow", async () => {
  const calls = [];
  const messages = [];

  await main({
    argv: ["node", "remodex", "restart"],
    platform: "linux",
    consoleImpl: {
      log(message) {
        messages.push(message);
      },
      error(message) {
        messages.push(message);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      readBridgeConfig() {
        calls.push("read-config");
      },
      async startLinuxBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          unitPath: "/tmp/remodex-bridge.service",
          pairingSession: { relay: "ws://127.0.0.1:9000/relay" },
        };
      },
    },
  });

  assert.deepEqual(calls, [
    "read-config",
    ["start-service", { waitForPairing: false }],
  ]);
  assert.deepEqual(messages, [
    "[remodex] Linux bridge service restarted.",
  ]);
});

test("remodex up starts the Linux service and prints the pairing QR", async () => {
  const calls = [];

  await main({
    argv: ["node", "remodex", "up"],
    platform: "linux",
    consoleImpl: {
      log() {},
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      async startLinuxBridgeService(options) {
        calls.push(["start-service", options]);
        return {
          pairingSession: {
            pairingPayload: {
              sessionId: "session-linux-up",
            },
          },
        };
      },
      printLinuxBridgePairingQr(options) {
        calls.push(["print-qr", options.pairingSession.pairingPayload.sessionId]);
      },
    },
  });

  assert.deepEqual(calls, [
    ["start-service", { waitForPairing: true }],
    ["print-qr", "session-linux-up"],
  ]);
});

test("remodex up falls back to foreground mode when Linux user systemd is unavailable", async () => {
  const calls = [];
  const warnings = [];

  await main({
    argv: ["node", "remodex", "up"],
    platform: "linux",
    consoleImpl: {
      log(message) {
        warnings.push(message);
      },
      warn(message) {
        warnings.push(message);
      },
      error(message) {
        throw new Error(`unexpected error: ${message}`);
      },
    },
    exitImpl(code) {
      throw new Error(`unexpected exit ${code}`);
    },
    deps: {
      async startLinuxBridgeService(options) {
        calls.push(["start-service", options]);
        const error = new Error("spawn systemctl ENOENT");
        error.code = "ENOENT";
        throw error;
      },
      printLinuxBridgePairingQr() {
        throw new Error("service QR printer should not run after fallback");
      },
      startBridge() {
        calls.push("start-bridge");
      },
    },
  });

  assert.deepEqual(calls, [
    ["start-service", { waitForPairing: true }],
    "start-bridge",
  ]);
  assert.deepEqual(warnings, [
    "[remodex] Linux user systemd is unavailable; running the bridge in the foreground.",
  ]);
});

test("remodex up preserves Linux service failures that are not systemd availability errors", async () => {
  await assert.rejects(
    main({
      argv: ["node", "remodex", "up"],
      platform: "linux",
      consoleImpl: {
        log() {},
        warn() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        async startLinuxBridgeService() {
          throw new Error("Timed out waiting for the Linux bridge service to publish a pairing QR.");
        },
        printLinuxBridgePairingQr() {
          throw new Error("service QR printer should not run after failure");
        },
        startBridge() {
          throw new Error("foreground fallback should not run for service health failures");
        },
      },
    }),
    /Timed out waiting/
  );
});

test("remodex up does not treat unrelated ENOENT failures as systemd fallback cases", async () => {
  await assert.rejects(
    main({
      argv: ["node", "remodex", "up"],
      platform: "linux",
      consoleImpl: {
        log() {},
        warn() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        async startLinuxBridgeService() {
          const error = new Error("ENOENT: no such file or directory, open '/tmp/remodex-config'");
          error.code = "ENOENT";
          throw error;
        },
        printLinuxBridgePairingQr() {
          throw new Error("service QR printer should not run after failure");
        },
        startBridge() {
          throw new Error("foreground fallback should not run for unrelated ENOENT failures");
        },
      },
    }),
    /remodex-config/
  );
});

test("remodex status --json exposes daemon metadata for companion apps", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "remodex", "status", "--json"],
      platform: "darwin",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        getMacOSBridgeServiceStatus() {
          return {
            daemonConfig: {
              relayUrl: "ws://127.0.0.1:9000/relay",
            },
            bridgeStatus: {
              connectionStatus: "connected",
              pid: 77,
            },
            pairingSession: {
              pairingPayload: {
                relay: "ws://127.0.0.1:9000/relay",
                sessionId: "session-json",
              },
            },
          };
        },
        printMacOSBridgeServiceStatus() {
          throw new Error("status printer should not run for --json");
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.daemonConfig?.relayUrl, "ws://127.0.0.1:9000/relay");
  assert.equal(payload.bridgeStatus?.connectionStatus, "connected");
  assert.equal(payload.pairingSession?.pairingPayload?.sessionId, "session-json");
});

test("remodex status --json exposes Linux systemd metadata", async () => {
  const writes = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    writes.push(String(chunk));
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  try {
    await main({
      argv: ["node", "remodex", "status", "--json"],
      platform: "linux",
      consoleImpl: {
        log() {},
        error(message) {
          throw new Error(`unexpected error: ${message}`);
        },
      },
      exitImpl(code) {
        throw new Error(`unexpected exit ${code}`);
      },
      deps: {
        getLinuxBridgeServiceStatus() {
          return {
            serviceName: "remodex-bridge.service",
            systemdActive: "active",
            systemdPid: 88,
            daemonConfig: {
              relayUrl: "ws://127.0.0.1:9000/relay",
            },
            bridgeStatus: {
              connectionStatus: "connected",
              pid: 88,
            },
          };
        },
        printLinuxBridgeServiceStatus() {
          throw new Error("status printer should not run for --json");
        },
      },
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const payload = JSON.parse(writes.join("").trim());
  assert.equal(payload.currentVersion, version);
  assert.equal(payload.serviceName, "remodex-bridge.service");
  assert.equal(payload.systemdActive, "active");
  assert.equal(payload.systemdPid, 88);
  assert.equal(payload.daemonConfig?.relayUrl, "ws://127.0.0.1:9000/relay");
});
