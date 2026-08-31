# Jared Desktop Assistant

Windows desktop assistant reconstructed from the supplied design handoff. It includes:

- Always-on-top animated Jared overlay with idle/walk/fix/talk states
- Separate compact control panel (Ctrl+Alt+J)
- Persona chat using `prompts/jared_chatbot_prompt.md`
- Real Windows desktop control through Claude Computer Use
- Plan-first human approval before any desktop task begins
- Emergency STOP button
- Local JSONL audit log; typed text is redacted from the log
- Anthropic API key encrypted with Electron `safeStorage` when available
- Overlay and panel hidden while screenshots are captured

## Windows setup

1. Install Node.js 20+ (LTS recommended).
2. Open PowerShell in this folder.
3. Run:
   ```powershell
   npm install
   npm start
   ```
4. Press **Ctrl+Alt+J** to open the control panel.
5. In **Settings**, paste an Anthropic API key and save it.

## Build a Windows installer

From Windows:

```powershell
npm install
npm run dist:win
```

The NSIS installer will be created under `dist/`.

## Important implementation notes

- Desktop input is intentionally Windows-only and uses PowerShell + `user32.dll` for mouse/keyboard actions.
- Claude is shown a resized screenshot, and coordinates are scaled back to the actual display.
- The current default model is `claude-sonnet-4-6`. You can change it in Settings if your Anthropic account supports another compatible computer-use model.
- The app intentionally stops short of passwords, payments, destructive deletion, legal acceptance, external sends, or other consequential final actions. Those should stay human-confirmed.
- For the safest deployment, run desktop automation in a dedicated Windows VM or least-privilege Windows account rather than giving an autonomous model unrestricted access to every sensitive system.

## Project layout

- `src/main/main.js` – Electron windows, IPC, hotkey
- `src/main/agent.js` – Claude chat, task planning, computer-use loop
- `src/main/desktop.js` – screenshots, scaling, computer actions
- `src/main/windowsInput.js` – Windows mouse/keyboard bridge
- `src/renderer/overlay.*` – character/animation overlay
- `src/renderer/panel.*` – chat/task/settings/audit UI
- `prompts/jared_chatbot_prompt.md` – persona system prompt supplied in the handoff
- `reference/` – original design references; not required at runtime
