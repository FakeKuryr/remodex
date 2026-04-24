// FILE: index.js
// Purpose: Small entrypoint wrapper for bridge lifecycle commands.
// Layer: CLI entry
// Exports: bridge lifecycle, pairing reset, thread resume/watch, and macOS service helpers.
// Depends on: ./bridge, ./secure-device-state, ./session-state, ./rollout-watch, ./macos-launch-agent

const { startBridge } = require("./bridge");
const { readBridgeDeviceState, resetBridgeDeviceState } = require("./secure-device-state");
const { openLastActiveThread } = require("./session-state");
const { watchThreadRollout } = require("./rollout-watch");
const { readBridgeConfig } = require("./codex-desktop-refresher");
const {
  getMacOSBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  resetMacOSBridgePairing,
  runMacOSBridgeService,
  startMacOSBridgeService,
  stopMacOSBridgeService,
} = require("./macos-launch-agent");
const {
  getLinuxBridgeServiceStatus,
  printLinuxBridgePairingQr,
  printLinuxBridgeServiceStatus,
  resetLinuxBridgePairing,
  runLinuxBridgeService,
  startLinuxBridgeService,
  stopLinuxBridgeService,
} = require("./linux-systemd-service");

module.exports = {
  getLinuxBridgeServiceStatus,
  getMacOSBridgeServiceStatus,
  printLinuxBridgePairingQr,
  printLinuxBridgeServiceStatus,
  printMacOSBridgePairingQr,
  printMacOSBridgeServiceStatus,
  readBridgeConfig,
  readBridgeDeviceState,
  resetLinuxBridgePairing,
  resetMacOSBridgePairing,
  startBridge,
  runLinuxBridgeService,
  runMacOSBridgeService,
  startLinuxBridgeService,
  startMacOSBridgeService,
  stopLinuxBridgeService,
  stopMacOSBridgeService,
  resetBridgePairing: resetBridgeDeviceState,
  openLastActiveThread,
  watchThreadRollout,
};
