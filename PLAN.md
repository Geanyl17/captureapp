# CaptureApp — Feature Roadmap

## Phase 1 — Tray + Capture (Core loop)

Goal: hotkey → region select → upload → link in clipboard. Everything else builds on this.

- [x] Main process scaffold (tray, shortcuts, IPC)
- [x] Preload bridge (`window.api`)
- [x] Supabase auth helpers
- [x] Upload helper (Bearer token → hostingapp)
- [ ] **Overlay window** — transparent fullscreen, click-drag to select region, rubber-band rect, ESC to cancel
- [ ] **Region capture** — use Electron's `desktopCapturer` + `nativeImage.crop()` on the selected rect
- [ ] **Upload flow** — capture → upload → copy link to clipboard → tray notification "Link copied"
- [ ] **Settings view** — email + password sign-in form, store session, sign-out button, hotkey display
- [ ] **App icons** — icon.icns / icon.ico / icon.png in `resources/` (required for packaging)

---

## Phase 2 — Annotation Editor

Goal: before uploading, optionally open the screenshot in an editor to annotate it.

- [ ] **Editor view** using Fabric.js canvas
  - Arrow tool
  - Rectangle / circle highlight
  - Text label
  - Freehand pen
  - Blur/censor brush (pixelate region)
  - Undo / redo
  - Color picker + stroke width
- [ ] After editing: export canvas to PNG blob → same upload flow as Phase 1
- [ ] Tray menu option: "capture → editor" vs "capture → upload directly" (configurable in settings)
- [ ] Copy to clipboard without uploading (local annotation use)

---

## Phase 3 — History

Goal: see recent captures without opening the browser.

- [ ] **History view** — list of recent uploads with thumbnails, timestamp, link
- [ ] Persist history in `electron-store` (last 50 items)
- [ ] Click item → copy link again
- [ ] Delete from history (removes from store, does NOT delete from hosting site)
- [ ] "Open in browser" link → `shell.openExternal(url)`

---

## Phase 4 — Screen Recording

Goal: hotkey to record a region or full screen, stop → upload MP4.

- [ ] **Record view** — shows recording state, timer, stop button
- [ ] `desktopCapturer` → `MediaRecorder` → WebM blob in renderer
- [ ] Send blob to main via IPC → save temp file → upload to hostingapp
- [ ] Configurable: full screen vs region select before recording starts
- [ ] Audio capture option (system audio / mic — platform-dependent)
- [ ] Tray icon changes to red dot while recording

---

## Phase 5 — Polish + Distribution

- [ ] Custom titlebar (frameless window, drag region)
- [ ] Keyboard shortcut configuration UI in Settings
- [ ] First-launch onboarding flow (sign in + permission prompts)
- [ ] macOS: request screen recording permission (`systemPreferences.askForMediaAccess`)
- [ ] Windows: SmartScreen bypass instructions on first run
- [ ] Auto-update tested end-to-end via GitHub Release
- [ ] GitHub Actions build matrix: win + mac + linux in one workflow

---

## Architecture Notes

### Capture flow (Phase 1)

```
hotkey fires (main)
  → show overlay window (transparent fullscreen)
  → user drags region
  → overlay sends { x, y, width, height } via IPC
  → main calls desktopCapturer.getSources() → crop → nativeImage
  → nativeImage.toPNG() → Buffer
  → send Buffer to renderer via IPC
  → renderer: new Blob([buffer]) → uploadImage() → URL
  → main: clipboard.writeText(url) + tray notification
```

### Auth flow

```
renderer: signIn(email, password) → Supabase session
  → storeSet('session', { access_token, refresh_token, expires_at })
renderer: on subsequent launch → restoreSession()
  → check expires_at, refresh if needed
  → pass access_token to upload.ts as Bearer header
```

### Upload API (hostingapp side)

`POST /api/upload` with `Authorization: Bearer <access_token>` already reads the token and resolves the user via `auth.getUser(token)`. No change needed to hostingapp for desktop uploads to work.

---

## Known Limitations / Future Work

- No multi-account switching (one session stored, sign out to switch)
- Recording audio on Linux requires PulseAudio/PipeWire setup
- Unsigned binary triggers OS warnings — code signing requires Apple/MS certificates ($99–$499/yr)
- Fabric.js v6 is ESM-only — requires `outputFileTracingIncludes` in electron-vite config if bundling issues arise
