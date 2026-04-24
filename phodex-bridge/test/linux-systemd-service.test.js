// FILE: linux-systemd-service.test.js
// Purpose: Verifies Linux user-systemd unit generation and service status parsing helpers.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/linux-systemd-service

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSystemdUserUnit,
  getLinuxBridgeServiceStatus,
} = require("../src/linux-systemd-service");

test("buildSystemdUserUnit runs remodex service entrypoint with persistent state paths", () => {
  const unit = buildSystemdUserUnit({
    homeDir: "/home/alice",
    pathEnv: "/usr/local/bin:/usr/bin",
    stateDir: "/home/alice/.remodex",
    stdoutLogPath: "/home/alice/.remodex/logs/bridge.stdout.log",
    stderrLogPath: "/home/alice/.remodex/logs/bridge.stderr.log",
    nodePath: "/usr/bin/node",
    cliPath: "/opt/remodex/bin/remodex.js",
  });

  assert.match(unit, /Description=Remodex bridge/);
  assert.match(unit, /ExecStart="\/usr\/bin\/node" "\/opt\/remodex\/bin\/remodex.js" run-service/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /WorkingDirectory=\/home\/alice/);
  assert.match(unit, /Environment="HOME=\/home\/alice" "PATH=\/usr\/local\/bin:\/usr\/bin" "REMODEX_DEVICE_STATE_DIR=\/home\/alice\/.remodex"/);
  assert.match(unit, /StandardOutput=append:\/home\/alice\/.remodex\/logs\/bridge.stdout.log/);
  assert.match(unit, /WantedBy=default.target/);
});

test("getLinuxBridgeServiceStatus combines systemd state with persisted bridge state", () => {
  const files = new Map([
    ["/home/alice/.config/systemd/user/remodex-bridge.service", "unit"],
    ["/home/alice/.remodex/daemon-config.json", JSON.stringify({
      relayUrl: "wss://relay.example/relay",
    })],
    ["/home/alice/.remodex/bridge-status.json", JSON.stringify({
      state: "running",
      connectionStatus: "connected",
      pid: 123,
    })],
    ["/home/alice/.remodex/pairing-session.json", JSON.stringify({
      pairingPayload: {
        sessionId: "session-linux",
      },
    })],
  ]);
  const fsImpl = {
    existsSync(filePath) {
      return files.has(filePath);
    },
    readFileSync(filePath) {
      return files.get(filePath);
    },
  };
  const execFileSyncImpl = (command, args) => {
    assert.equal(command, "systemctl");
    assert.deepEqual(args, [
      "--user",
      "show",
      "remodex-bridge.service",
      "--property=ActiveState,SubState,MainPID",
      "--no-page",
    ]);
    return "ActiveState=active\nSubState=running\nMainPID=123\n";
  };

  const status = getLinuxBridgeServiceStatus({
    env: {
      HOME: "/home/alice",
    },
    platform: "linux",
    execFileSyncImpl,
    fsImpl,
    osImpl: {
      homedir() {
        return "/home/alice";
      },
    },
  });

  assert.equal(status.installed, true);
  assert.equal(status.systemdActive, "active");
  assert.equal(status.systemdSubState, "running");
  assert.equal(status.systemdPid, 123);
  assert.equal(status.daemonConfig.relayUrl, "wss://relay.example/relay");
  assert.equal(status.bridgeStatus.connectionStatus, "connected");
  assert.equal(status.pairingSession.pairingPayload.sessionId, "session-linux");
});
