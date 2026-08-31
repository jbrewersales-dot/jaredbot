const path = require('path');
const { app, BrowserWindow, ipcMain, globalShortcut, shell, screen } = require('electron');
const { getSettings, saveSettings } = require('./settings');
const audit = require('./audit');
const { DesktopController } = require('./desktop');
const { JaredAgent } = require('./agent');

let overlayWin, panelWin, agent, desktop;

function sendStatus(data) {
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('status', data);
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('overlay', { type:'status', ...data });
}
function appendAudit(data) {
  const row = audit.append(data);
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('audit', row);
  return row;
}

function createWindows() {
  const display = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    transparent:true, frame:false, alwaysOnTop:true, skipTaskbar:true, focusable:false, resizable:false,
    hasShadow:false, backgroundColor:'#00000000',
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  overlayWin.setIgnoreMouseEvents(true, { forward:true });
  overlayWin.loadFile(path.join(__dirname,'../renderer/overlay.html'));

  panelWin = new BrowserWindow({
    width:460, height:760, minWidth:400, minHeight:600, show:false, frame:false, alwaysOnTop:true,
    backgroundColor:'#161826', title:'Jared Desktop Assistant',
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  panelWin.loadFile(path.join(__dirname,'../renderer/panel.html'));
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panelWin.hide(); } });

  desktop = new DesktopController(() => [overlayWin, panelWin], async ev => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('overlay', { type:'action', ...ev });
    sendStatus({ state: ev.action === 'type' ? 'talking' : 'fixing', text:ev.label });
  });
  agent = new JaredAgent({ desktop, getSettings, onStatus:sendStatus, onAudit:appendAudit });
}

function togglePanel() {
  if (!panelWin) return;
  if (panelWin.isVisible()) panelWin.hide();
  else { panelWin.show(); panelWin.focus(); }
}

app.whenReady().then(() => {
  createWindows();
  globalShortcut.register('CommandOrControl+Alt+J', togglePanel);
  app.setLoginItemSettings({ openAtLogin:getSettings().launchAtLogin });
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', e => { /* tray-style app stays running */ });

ipcMain.handle('chat', async (_, {text, mode}) => {
  try { sendStatus({state:'thinking', text:'Thinking…'}); const out = await agent.chat(text, mode); sendStatus({state:'talking', text:out.slice(0,240)}); return {ok:true, text:out}; }
  catch(e){ sendStatus({state:'idle', text:'All quiet. For now.'}); return {ok:false, error:e.message}; }
});
ipcMain.handle('task:plan', async (_, {task}) => {
  try { sendStatus({state:'thinking', text:'Working up a plan…'}); const plan = await agent.planTask(task); sendStatus({state:'talking', text:plan.slice(0,240)}); return {ok:true, plan}; }
  catch(e){ return {ok:false, error:e.message}; }
});
ipcMain.handle('task:run', async (_, {task}) => {
  try { sendStatus({state:'walking', text:'Heading over…'}); const text = await agent.runTask(task); return {ok:true, text}; }
  catch(e){ appendAudit({kind:'task_error', error:e.message}); sendStatus({state:'idle', text:e.message === 'Task stopped by user.' ? 'Stopped.' : 'Hit a snag.'}); return {ok:false,error:e.message}; }
});
ipcMain.handle('task:stop', () => { agent.stop(); appendAudit({kind:'task_stop'}); sendStatus({state:'idle',text:'Stopped.'}); return {ok:true}; });
ipcMain.handle('settings:get', () => { const s=getSettings(); return {...s, apiKey:s.apiKey ? '••••••••' + s.apiKey.slice(-4) : ''}; });
ipcMain.handle('settings:save', (_, data) => {
  const current=getSettings(); const next={...data};
  if (typeof next.apiKey === 'string' && next.apiKey.startsWith('••••••••')) next.apiKey=current.apiKey;
  const saved=saveSettings(next); app.setLoginItemSettings({openAtLogin:saved.launchAtLogin});
  appendAudit({kind:'settings_updated'}); return {...saved, apiKey:saved.apiKey ? '••••••••'+saved.apiKey.slice(-4):''};
});
ipcMain.handle('audit:get', () => audit.recent());
ipcMain.handle('audit:open', () => shell.showItemInFolder(audit.logPath()));
ipcMain.handle('panel:hide', () => { panelWin.hide(); return {ok:true}; });
ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); return {ok:true}; });
