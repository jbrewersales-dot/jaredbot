const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readRaw() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return {}; }
}

function writeRaw(value) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2));
}

function getSettings() {
  const raw = readRaw();
  let apiKey = '';
  if (raw.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEncrypted, 'base64')); } catch {}
  }
  return {
    apiKey,
    model: raw.model || 'claude-opus-5',
    approvalMode: raw.approvalMode || 'task',
    maxIterations: Number(raw.maxIterations || 25),
    launchAtLogin: !!raw.launchAtLogin
  };
}

function saveSettings(next) {
  const raw = readRaw();
  if (typeof next.apiKey === 'string' && safeStorage.isEncryptionAvailable()) {
    raw.apiKeyEncrypted = safeStorage.encryptString(next.apiKey).toString('base64');
  }
  if (next.model) raw.model = next.model;
  if (next.approvalMode) raw.approvalMode = next.approvalMode;
  if (next.maxIterations) raw.maxIterations = Number(next.maxIterations);
  if (typeof next.launchAtLogin === 'boolean') raw.launchAtLogin = next.launchAtLogin;
  writeRaw(raw);
  return getSettings();
}

module.exports = { getSettings, saveSettings };
