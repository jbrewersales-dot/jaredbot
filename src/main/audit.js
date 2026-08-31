const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function logPath() {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'activity.jsonl');
}

function append(entry) {
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(logPath(), JSON.stringify(row) + '\n');
  return row;
}

function recent(limit = 150) {
  try {
    const lines = fs.readFileSync(logPath(), 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).reverse().map(x => JSON.parse(x));
  } catch { return []; }
}

module.exports = { append, recent, logPath };
