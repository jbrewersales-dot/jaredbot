const { desktopCapturer, screen, nativeImage } = require('electron');
const { runPowerShell, pasteText } = require('./windowsInput');

class DesktopController {
  constructor(getWindows, onAction) {
    this.getWindows = getWindows;
    this.onAction = onAction;
    this.lastShot = null;
  }

  async withHiddenUi(fn) {
    const wins = this.getWindows().filter(Boolean);
    const states = wins.map(w => ({ w, visible: w.isVisible() }));
    for (const { w } of states) w.hide();
    await new Promise(r => setTimeout(r, 120));
    try { return await fn(); }
    finally { for (const { w, visible } of states) if (visible && !w.isDestroyed()) w.showInactive(); }
  }

  async capture() {
    return this.withHiddenUi(async () => {
      const display = screen.getPrimaryDisplay();
      const physicalW = Math.round(display.size.width * display.scaleFactor);
      const physicalH = Math.round(display.size.height * display.scaleFactor);
      const longEdge = Math.max(physicalW, physicalH);
      const total = physicalW * physicalH;
      const scale = Math.min(1, 1568 / longEdge, Math.sqrt(1150000 / total));
      const width = Math.max(640, Math.round(physicalW * scale));
      const height = Math.max(360, Math.round(physicalH * scale));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
      if (!source) throw new Error('No screen source available.');
      const img = source.thumbnail;
      const actual = img.getSize();
      this.lastShot = { image: img, display, modelW: actual.width, modelH: actual.height, physicalW, physicalH };
      return { base64: img.toPNG().toString('base64'), width: actual.width, height: actual.height };
    });
  }

  ensureShot() {
    if (!this.lastShot) throw new Error('A screenshot must be taken before coordinate actions.');
    return this.lastShot;
  }

  toScreen([x, y]) {
    const s = this.ensureShot();
    const sx = Math.round((x / s.modelW) * s.physicalW + s.display.bounds.x * s.display.scaleFactor);
    const sy = Math.round((y / s.modelH) * s.physicalH + s.display.bounds.y * s.display.scaleFactor);
    return [sx, sy];
  }

  async execute(input) {
    const action = input.action;
    const shot = this.lastShot;
    const emit = async (label, point) => { if (this.onAction) await this.onAction({ action, label, point, modelSize: shot ? [shot.modelW, shot.modelH] : null, input }); };
    if (action === 'screenshot') {
      const s = await this.capture();
      await emit('Taking a look…');
      return { type: 'image', base64: s.base64 };
    }
    if (action === 'zoom') {
      const s = this.ensureShot();
      const [x1,y1,x2,y2] = input.region;
      const x = Math.max(0, Math.min(x1,x2)); const y = Math.max(0, Math.min(y1,y2));
      const width = Math.max(1, Math.min(s.modelW-x, Math.abs(x2-x1)));
      const height = Math.max(1, Math.min(s.modelH-y, Math.abs(y2-y1)));
      const crop = s.image.crop({ x, y, width, height });
      await emit('Zooming in…', [x + width/2, y + height/2]);
      return { type: 'image', base64: crop.toPNG().toString('base64') };
    }
    if (action === 'wait') {
      const seconds = Math.min(20, Math.max(0, Number(input.duration || 1)));
      await emit('Waiting…');
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { type: 'text', text: `Waited ${seconds}s` };
    }
    if (action === 'type') {
      await emit(`Typing ${String(input.text || '').length} characters…`);
      await pasteText(String(input.text || ''));
      return { type: 'text', text: 'Typed text' };
    }
    if (action === 'key') {
      await emit(`Pressing ${input.text || input.key || 'key'}…`);
      await runPowerShell({ action:'key', key: input.text || input.key });
      return { type:'text', text:'Key pressed' };
    }
    if (action === 'hold_key') {
      await emit(`Holding ${input.text || input.key || 'key'}…`);
      await runPowerShell({ action:'hold_key', key: input.text || input.key, duration: input.duration || 1 });
      return { type:'text', text:'Key held' };
    }
    const coord = input.coordinate || [0,0];
    const [sx, sy] = this.toScreen(coord);
    if (action === 'mouse_move') {
      await emit('Heading over…', coord);
      await runPowerShell({ action:'move', x:sx, y:sy });
    } else if (['left_click','right_click','middle_click','double_click','triple_click'].includes(action)) {
      const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
      const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
      await emit(`Clicking ${button}…`, coord);
      await runPowerShell({ action:'click', x:sx, y:sy, button, count });
    } else if (action === 'left_mouse_down' || action === 'left_mouse_up') {
      await emit(action === 'left_mouse_down' ? 'Mouse down…' : 'Mouse up…', coord);
      await runPowerShell({ action: action === 'left_mouse_down' ? 'down' : 'up', x:sx, y:sy, button:'left' });
    } else if (action === 'left_click_drag') {
      const start = input.start_coordinate || input.coordinate || [0,0];
      const end = input.coordinate || input.end_coordinate || [0,0];
      const [x1,y1] = this.toScreen(start); const [x2,y2] = this.toScreen(end);
      await emit('Dragging…', end);
      await runPowerShell({ action:'drag', x1,y1,x2,y2 });
    } else if (action === 'scroll') {
      await emit(`Scrolling ${input.scroll_direction || input.direction || 'down'}…`, coord);
      const amount = Math.max(120, Number(input.scroll_amount || input.amount || 480));
      await runPowerShell({ action:'scroll', x:sx, y:sy, direction: input.scroll_direction || input.direction || 'down', amount });
    } else {
      throw new Error(`Unsupported computer action: ${action}`);
    }
    await new Promise(r => setTimeout(r, 160));
    return { type:'text', text:`Completed ${action}` };
  }
}

module.exports = { DesktopController };
