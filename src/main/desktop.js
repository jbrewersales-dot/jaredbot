const { desktopCapturer, screen } = require('electron');
const { runPowerShell, pasteText, cursorPosition } = require('./windowsInput');

// Claude sees a downscaled screenshot. 1080p is the documented balance of
// accuracy and image-token cost for computer use; the hard ceilings are
// 2576px on the long edge and 3.75MP total.
const MAX_LONG_EDGE = 1920;
const MAX_PIXELS = 1920 * 1080;

const CLICKS = {
  left_click: { button: 'left', count: 1 },
  right_click: { button: 'right', count: 1 },
  middle_click: { button: 'middle', count: 1 },
  double_click: { button: 'left', count: 2 },
  triple_click: { button: 'left', count: 3 }
};

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

  displayGeometry() {
    const display = screen.getPrimaryDisplay();
    return {
      display,
      physicalW: Math.round(display.size.width * display.scaleFactor),
      physicalH: Math.round(display.size.height * display.scaleFactor)
    };
  }

  async grab(width, height) {
    const { display } = this.displayGeometry();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen source available.');
    return source.thumbnail;
  }

  async capture() {
    return this.withHiddenUi(async () => {
      const { display, physicalW, physicalH } = this.displayGeometry();
      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(physicalW, physicalH), Math.sqrt(MAX_PIXELS / (physicalW * physicalH)));
      const img = await this.grab(Math.max(640, Math.round(physicalW * scale)), Math.max(360, Math.round(physicalH * scale)));
      const actual = img.getSize();
      this.lastShot = { display, modelW: actual.width, modelH: actual.height, physicalW, physicalH };
      return { base64: img.toPNG().toString('base64'), width: actual.width, height: actual.height };
    });
  }

  ensureShot() {
    if (!this.lastShot) throw new Error('A screenshot must be taken before coordinate actions.');
    return this.lastShot;
  }

  // Screenshot pixels -> physical screen pixels.
  toScreen([x, y]) {
    const s = this.ensureShot();
    return [
      Math.round((x / s.modelW) * s.physicalW + s.display.bounds.x * s.display.scaleFactor),
      Math.round((y / s.modelH) * s.physicalH + s.display.bounds.y * s.display.scaleFactor)
    ];
  }

  // Physical screen pixels -> screenshot pixels.
  toModel([x, y]) {
    const s = this.ensureShot();
    return [
      Math.round(((x - s.display.bounds.x * s.display.scaleFactor) / s.physicalW) * s.modelW),
      Math.round(((y - s.display.bounds.y * s.display.scaleFactor) / s.physicalH) * s.modelH)
    ];
  }

  // Capture the requested region at native resolution rather than cropping the
  // already-downscaled screenshot, so zoom actually reveals more detail.
  async zoom(region) {
    const s = this.ensureShot();
    const [x1, y1, x2, y2] = region.map(Number);
    const mx = Math.max(0, Math.min(s.modelW - 1, Math.min(x1, x2)));
    const my = Math.max(0, Math.min(s.modelH - 1, Math.min(y1, y2)));
    const mw = Math.max(1, Math.min(s.modelW - mx, Math.abs(x2 - x1)));
    const mh = Math.max(1, Math.min(s.modelH - my, Math.abs(y2 - y1)));

    return this.withHiddenUi(async () => {
      const full = await this.grab(s.physicalW, s.physicalH);
      const size = full.getSize();
      const x = Math.round((mx / s.modelW) * size.width);
      const y = Math.round((my / s.modelH) * size.height);
      const width = Math.max(1, Math.min(size.width - x, Math.round((mw / s.modelW) * size.width)));
      const height = Math.max(1, Math.min(size.height - y, Math.round((mh / s.modelH) * size.height)));
      let crop = full.crop({ x, y, width, height });
      const cs = crop.getSize();
      const fit = Math.min(1, MAX_LONG_EDGE / Math.max(cs.width, cs.height), Math.sqrt(MAX_PIXELS / (cs.width * cs.height)));
      if (fit < 1) crop = crop.resize({ width: Math.max(1, Math.round(cs.width * fit)), height: Math.max(1, Math.round(cs.height * fit)) });
      return { base64: crop.toPNG().toString('base64'), center: [mx + mw / 2, my + mh / 2] };
    });
  }

  /**
   * Execute one member tool of the computer toolset.
   * `name` is the member tool name (left_click, type, zoom, ...) and `input`
   * its arguments; the toolset has no single "action" field.
   */
  async execute(name, input = {}) {
    const s = this.lastShot;
    const emit = async (label, point) => {
      if (this.onAction) await this.onAction({ action: name, label, point, modelSize: s ? [s.modelW, s.modelH] : null, input });
    };
    const modifiers = typeof input.text === 'string' && CLICKS[name] ? input.text : '';
    const hasCoordinate = Array.isArray(input.coordinate);
    const point = hasCoordinate ? input.coordinate : null;
    const at = () => {
      const [x, y] = this.toScreen(input.coordinate);
      return { x, y, hasCoordinate: true };
    };

    if (name === 'screenshot') {
      const shot = await this.capture();
      await emit('Taking a look…');
      return { type: 'image', base64: shot.base64 };
    }

    if (name === 'zoom') {
      if (!Array.isArray(input.region) || input.region.length !== 4) throw new Error('zoom requires a region [x0, y0, x1, y1].');
      const z = await this.zoom(input.region);
      await emit('Zooming in…', z.center);
      return { type: 'image', base64: z.base64 };
    }

    if (name === 'wait') {
      const seconds = Math.min(300, Math.max(0, Number(input.duration ?? 1)));
      await emit('Waiting…');
      await new Promise(r => setTimeout(r, seconds * 1000));
      return { type: 'text', text: `Waited ${seconds}s` };
    }

    if (name === 'cursor_position') {
      const [mx, my] = this.toModel(await cursorPosition());
      await emit('Checking the cursor…', [mx, my]);
      return { type: 'text', text: `X=${mx}, Y=${my}` };
    }

    if (name === 'type') {
      const text = String(input.text ?? '');
      await emit(`Typing ${text.length} characters…`);
      await pasteText(text);
      return { type: 'text', text: 'OK' };
    }

    if (name === 'key') {
      const repeat = Math.min(100, Math.max(1, Number(input.repeat ?? 1)));
      await emit(`Pressing ${input.text}…`);
      await runPowerShell({ action: 'key', key: input.text, repeat });
      return { type: 'text', text: 'OK' };
    }

    if (name === 'hold_key') {
      const duration = Math.min(300, Math.max(0, Number(input.duration ?? 1)));
      await emit(`Holding ${input.text}…`);
      await runPowerShell({ action: 'hold_key', key: input.text, duration });
      return { type: 'text', text: 'OK' };
    }

    if (name === 'mouse_move') {
      await emit('Heading over…', point);
      await runPowerShell({ action: 'move', ...at() });
      return { type: 'text', text: 'OK' };
    }

    if (CLICKS[name]) {
      const { button, count } = CLICKS[name];
      await emit(`Clicking ${button}…`, point);
      await runPowerShell({ action: 'click', button, count, modifiers, ...(hasCoordinate ? at() : { hasCoordinate: false }) });
      await new Promise(r => setTimeout(r, 160));
      return { type: 'text', text: 'OK' };
    }

    if (name === 'left_mouse_down' || name === 'left_mouse_up') {
      await emit(name === 'left_mouse_down' ? 'Mouse down…' : 'Mouse up…', point);
      await runPowerShell({ action: name === 'left_mouse_down' ? 'down' : 'up', button: 'left', ...(hasCoordinate ? at() : { hasCoordinate: false }) });
      return { type: 'text', text: 'OK' };
    }

    if (name === 'left_click_drag') {
      if (!Array.isArray(input.start_coordinate) || !hasCoordinate) throw new Error('left_click_drag requires start_coordinate and coordinate.');
      const [x1, y1] = this.toScreen(input.start_coordinate);
      const [x2, y2] = this.toScreen(input.coordinate);
      await emit('Dragging…', input.coordinate);
      await runPowerShell({ action: 'drag', x1, y1, x2, y2, modifiers: typeof input.text === 'string' ? input.text : '' });
      await new Promise(r => setTimeout(r, 160));
      return { type: 'text', text: 'OK' };
    }

    if (name === 'scroll') {
      const direction = input.scroll_direction || 'down';
      // scroll_amount is a count of wheel clicks; WHEEL_DELTA is 120 per click.
      const amount = Math.max(1, Number(input.scroll_amount ?? 3)) * 120;
      await emit(`Scrolling ${direction}…`, point);
      await runPowerShell({ action: 'scroll', direction, amount, modifiers: typeof input.text === 'string' ? input.text : '', ...(hasCoordinate ? at() : { hasCoordinate: false }) });
      await new Promise(r => setTimeout(r, 160));
      return { type: 'text', text: 'OK' };
    }

    throw new Error(`Unsupported computer tool: ${name}`);
  }
}

module.exports = { DesktopController };
