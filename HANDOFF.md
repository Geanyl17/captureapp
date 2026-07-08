# CaptureApp — Developer Handoff

## What this app is

Electron 43 + electron-vite + React 19 + TypeScript desktop screenshot/annotation app.
- **Target platforms**: Bazzite Linux (KDE Plasma, Wayland), Windows
- **Repo**: https://github.com/Geanyl17/captureapp
- **Hosting backend**: https://hosting.geanyl.site (separate Next.js app at `/home/geanyl/codingprojects/hostingapp`)
- **Supabase project**: `mfxbnqbxcapijhskuknd.supabase.co`

## User's setup

- **OS**: Bazzite Linux (KDE Plasma 6, Wayland)
- **Monitors**: 2560×1440 (main, left) + 1920×1080 (secondary, right)
- **Virtual desktop**: 4480×1440 combined
- **Electron misidentifies primary**: `screen.getPrimaryDisplay()` returns the 1920×1080 monitor, NOT the 2560×1440 one. This has caused every multi-monitor bug.

---

## Current state of each feature

### ✅ Working
- Main window UI (Home, History, Record, Settings, Editor views)
- Tray icon with right-click menu
- Global shortcuts (Ctrl+Shift+S / Ctrl+Shift+R, configurable)
- Supabase login/logout
- Upload to hosting.geanyl.site via main process IPC (bypasses CORS)
- History view (last 50 captures, stored via electron-store)
- Recording view (source picker → MediaRecorder → upload)
- Editor annotations: fabric.js pen, rect, arrow, text, color/width pickers, undo, clear
- Copy image to clipboard, copy link
- Auto-updater

### Platform status

**Windows — primary target, should now work.** The real bug was in `captureDesktop()`:
the per-monitor branch (the one Windows uses) read `x/y/width/height` off the `Display`
object instead of `Display.bounds`, so they were `undefined` → every crop coordinate was
`NaN` → garbage capture. Fixed. Cannot be verified from the Linux dev box — needs testing
on an actual Windows machine (`npm run dev`) or via the CI NSIS installer.

**Linux capture file — fixed.** spectacle itself captures correctly. The user keeps
spectacle resident on D-Bus (`org.kde.Spectacle`), so a plain `spectacle -b -r …` was
handed to that instance and the CLI returned *before* the PNG was written → Electron read
a half-written file. Fixed with the `-i` flag (isolated instance, doesn't register on
D-Bus, so `-b` blocks until the file is complete). See `captureWaylandRegion()`. Verified:
the written PNG has correct, full content.

**Linux display — NOT app-fixable.** On this KDE Wayland + bleeding-edge Mesa (Bazzite,
kernel `7.0.9-ogc3`), Chromium paints the *entire Electron window* into the top-left
quarter of its surface, rest blank — a compositor/driver buffer-scale bug, independent of
the app (the capture file is provably correct; the DOM/canvas sizes log correct; only the
presented pixels are quartered). Neither `disableHardwareAcceleration()`, disabling Vulkan,
nor an in-code `ozone-platform-hint=x11` switch fixed it. The only untested lever left is
launching under XWayland via the env var `ELECTRON_OZONE_PLATFORM_HINT=x11`. Treat Linux as
a known-broken environment for now; develop/test on Windows.

---

## The broken flow — screenshot capture

### What SHOULD happen
1. User presses `Ctrl+Shift+S`
2. App hides main window
3. A transparent fullscreen overlay appears — user draws a rectangle
4. App takes screenshot of exactly the selected region
5. Editor opens with the captured image for annotation

### What currently happens (as of latest commit)

**On Wayland** (`onWayland()` returns true):  
`startCapture()` now calls `captureWaylandRegion()` which runs `spectacle -b -n -r -o /tmp/file.png`.  
This opens spectacle's own region selector. **Result: spectacle's selector appears but the captured image in the editor is WRONG — it's a small portion of the screen, not the selected region.** The images the user shared show the editor canvas displaying a tiny snippet (e.g., 383×290 area) with dark background filling the rest.

**The two screenshots the user sent at the end of the session show clearly:**
1. Full spectacle selector covers the screen correctly
2. The captured result in the editor is a small fraction of what was selected

This means the issue is now in how the resulting image file from spectacle is being loaded/sent, OR spectacle `-r` is not capturing the exact selected region correctly and is instead doing something unexpected (possibly saving the full screen then the -r flag is not working as expected on this KDE version).

---

## Full history of attempted fixes (all failed on Wayland)

### Attempt 1: Custom transparent overlay window
- Created `Overlay.tsx` — fullscreen canvas, user draws rect, sends local coords
- Problem: `screen.getPrimaryDisplay()` returns 1920×1080 (wrong monitor)
- Overlay appeared on wrong monitor (1920×1080 instead of 2560×1440)

### Attempt 2: `spectacle -b -n -f` (full screen) then crop
- Spectacle captured full virtual desktop: 4480×1440
- Scale math: `scaleX = imgW / logW` but `logW` was 1920 (wrong display) → `scaleX = 4480/1920 = 2.33`
- Result: crop was at wrong coordinates, showing only a quarter of screen

### Attempt 3: Derive scale from actual image vs logical dims
- Changed `captureWayland` to compute scale from `img.getSize()` vs `display.bounds`
- Still used wrong `display.bounds` (1920×1080) so math was still wrong

### Attempt 4: `fullscreen: true` in overlay BrowserWindow
- KDE Wayland still put the fullscreen window on the 1920×1080 monitor
- `window.innerWidth` in the overlay was 1920, not 2560

### Attempt 5: Cursor-based display selection
- `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())` to pick which monitor
- Problem: even if overlay went to the right monitor, `overlayWindow.getBounds()` returns `{x:0,y:0}` on Wayland for fullscreen windows — Wayland doesn't expose window positions to apps

### Attempt 6: Use `overlayDisplay.bounds` offset (stored before creating overlay)
- Converted overlay-local rect to virtual desktop coords using `overlayDisplay.bounds.x/y`
- `captureWayland` computed `totalLogW` from all displays and scaled correctly
- BUT: the spectacle image was 4480×1440 and `totalLogW` was also 4480, so scale=1:1
- This SHOULD have worked but the overlay was still on the wrong monitor
- The user's `window.innerWidth` in the fullscreen overlay was 1920 (wrong monitor)

### Attempt 7 (current): `spectacle -b -n -r` native region selector
- Bypass the overlay entirely on Wayland
- Let spectacle handle region selection
- **STILL BROKEN**: editor shows wrong/small capture

---

## Key code locations

### Main process: `src/main/index.ts`

```
startCapture()        — line ~197: if Wayland → captureWaylandRegion(), else custom overlay
captureWaylandRegion() — line ~224: runs spectacle -b -n -r, reads file, sends to editor
captureDesktop()      — line ~244: X11/Windows path using desktopCapturer (not used on Wayland)
createOverlayWindow() — line ~88: creates transparent fullscreen BrowserWindow (unused on Wayland now)
```

**`capture-region` IPC** (line ~326): overlay sends local coords → converted to virtual using `overlayWindow.getBounds()` (UNRELIABLE on Wayland — always returns {x:0,y:0} for fullscreen windows). Should use `overlayDisplay.bounds` instead, but this whole path is currently bypassed on Wayland.

### Renderer: `src/renderer/src/views/Overlay.tsx`
- Canvas sized to `window.innerWidth × window.innerHeight`
- Mouse coords from `e.clientX, e.clientY` (CSS logical pixels)
- Sends rect via `window.api.captureRegion(rect)` (overlay-local coordinates, not virtual desktop)
- Currently unused on Wayland (spectacle path bypasses the overlay)

### Renderer: `src/renderer/src/views/Editor.tsx`
- Full fabric.js annotation canvas
- `getOutput()` returns `fc.toDataURL()` for upload/copy

### `src/preload/index.ts`
- Exposes all IPC channels as `window.api.*`
- `window.api.captureRegion(rect)` — sends rect to main

---

## The actual root problem (diagnosis)

**`screen.getPrimaryDisplay()` returns the wrong display on this Wayland setup.**

```
Electron says primary: { width: 1920, height: 1080 }
Actual main monitor:   { width: 2560, height: 1440 }
```

This is a KDE/Wayland/Electron bug. Electron queries the Wayland compositor for the "primary" output but KDE reports the wrong one (probably because the user's "primary" in KDE display settings doesn't match what Electron sees via the Wayland protocol).

**Consequence for spectacle -r approach:**  
Unclear why the captured result is wrong when using spectacle's own region selector. Spectacle handles everything internally. The resulting `.png` file should already be cropped to the selected region. The issue might be:
1. Spectacle `-r` on this KDE version saves a full-screen image, not just the selected region
2. The file is being read before spectacle finishes writing it
3. The file path has an issue (spaces in tmpdir path?)
4. `nativeImage.createFromPath(tmp).isEmpty()` is false but the image data is incorrect

**Debug step needed**: Log `img.getSize()` after reading the spectacle output file to see what dimensions we actually got.

---

## What to try next

### Option A: Debug spectacle -r output
Add logging in `captureWaylandRegion()`:
```ts
const img = nativeImage.createFromPath(tmp)
const sz = img.getSize()
console.log('[spectacle-r] file:', tmp, 'size:', sz)
// If sz shows full virtual desktop (4480×1440), spectacle -r is not cropping
// If sz shows correct region dimensions, the image is correct and the issue is elsewhere
```

### Option B: If spectacle -r gives full screen, use its `--region` CLI flag instead
Some KDE/spectacle versions support:
```bash
spectacle -b -n --region x,y,width,height -o file.png
```
This would let us use our own overlay for selection UI, then pass the coordinates to spectacle for the actual capture.

### Option C: Use xdg-desktop-portal screenshot API
The XDG Desktop Portal has a `org.freedesktop.portal.Screenshot` D-Bus interface that correctly handles Wayland screenshot permissions. Can be called via:
```bash
dbus-send --session --print-reply --dest=org.freedesktop.portal.Desktop \
  /org/freedesktop/portal/desktop \
  org.freedesktop.portal.Screenshot.Screenshot \
  string:'' dict:string:variant:''
```
Or use the `@xdg-go/portal` Node package.

### Option D: `grim` tool
`grim` is a Wayland screenshot tool that may be available:
```bash
grim -g "x,y wxh" output.png
```
Where x,y,w,h are virtual desktop coordinates. Note: `grim` uses `wlr-screencopy-v1` protocol, which KDE Plasma 5.25+ supports. On Bazzite/KDE, this might work.
If it works, the flow would be:
1. Custom overlay collects region (even if on wrong monitor, we can get virtual coords via `overlayDisplay.bounds`)
2. Close overlay
3. `grim -g "${dispX + rect.x},${dispY + rect.y} ${rect.width}x${rect.height}" output.png`
4. Send to editor

### Option E: Fix the overlay window position properly
The real fix is to get the overlay onto the correct monitor. This requires either:
- Figuring out why KDE reports the wrong primary display to Electron
- Running `spectacle --region` with coordinates gathered from our overlay

### Critical fix regardless of approach
In `capture-region` IPC handler, `overlayWindow.getBounds()` ALWAYS returns `{x:0,y:0}` on Wayland for fullscreen windows. Replace with:
```ts
const dispX = overlayDisplay?.bounds.x ?? 0
const dispY = overlayDisplay?.bounds.y ?? 0
```

---

## File structure
```
captureapp/
├── src/
│   ├── main/index.ts          — Electron main process (capture logic here)
│   ├── preload/index.ts       — IPC bridge
│   └── renderer/src/
│       ├── App.tsx            — Router: Home/History/Record/Settings/Editor/Overlay
│       ├── views/
│       │   ├── Overlay.tsx    — Region selection canvas (bypassed on Wayland now)
│       │   ├── Editor.tsx     — fabric.js annotation + upload
│       │   ├── History.tsx    — Past captures grid
│       │   ├── Record.tsx     — Screen recording
│       │   └── Settings.tsx   — Keybind config
│       ├── lib/
│       │   ├── supabase.ts    — Supabase client (anon key)
│       │   └── upload.ts      — uploadImage() → IPC to main
│       └── index.css          — Inter Variable font, dark theme
├── resources/
│   ├── tray.png              — 22×22 tray icon
│   └── icon.png              — 256×256 app icon
├── .env.production            — VITE_SUPABASE_URL, KEY, UPLOAD_API_URL (committed, safe)
├── .github/workflows/release.yml  — Windows NSIS installer on tag push
└── package.json
```

## Environment variables (.env.production)
```
VITE_SUPABASE_URL=https://mfxbnqbxcapijhskuknd.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_tPgd_HdLR4NvfS_0KwbleA_gRvYcA7Q
VITE_UPLOAD_API_URL=https://hosting.geanyl.site
```

## Dev commands
```bash
npm run dev          # Electron + Vite dev server (hot reload)
npm run build        # Build renderer + main → out/
npm run build:win    # Build + package Windows NSIS installer
```

## Key dependencies
- `electron` ^43.0.0
- `electron-vite` ^3.0.0
- `react` ^19.0.0
- `fabric` ^7.4.0 (annotation canvas)
- `@supabase/supabase-js` ^2.49.4
- `electron-store` ^8.2.0 (persistent settings/history)
- `electron-updater` ^6.6.2 (auto-update)
- `@fontsource-variable/inter` ^5.2.8

## Important constraints
- Never use `request.url` in hostingapp — build absolute URLs with `PUBLIC_APP_URL`
- Upload must use Bearer JWT auth (main process sends `Authorization: Bearer <token>`, no cookies)
- `process.platform` is not available in renderer — use `window.electron?.process?.platform`
- `fetch(dataUrl)` is blocked by CSP — use `atob()` to convert data URLs to Blob
- Upload routes through main process IPC to bypass renderer CORS restrictions
- fabric.js 7: use `originX: 'left', originY: 'top'` on Rect (defaults to center which breaks drawing)
- fabric.js 7: don't use `{ pointer }` from mouse events on Wayland — use native DOM events + `getBoundingClientRect()`
