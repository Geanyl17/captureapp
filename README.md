# CaptureApp

Personal desktop screenshot, annotation, and screen recording app.
Uploads directly to [hosting.geanyl.site](https://hosting.geanyl.site) — link goes to clipboard automatically.

---

## Features (planned — see PLAN.md for roadmap)

- **Screenshot** — region, window, or full screen via hotkey
- **Annotation** — arrows, shapes, text, freehand, blur/censor
- **Upload** — one click to your hosting account, share link copied
- **Recording** — capture screen video and upload as MP4
- **Tray** — lives in background, always ready
- **Accounts** — sign in with your Supabase credentials, uploads go to your dashboard

---

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm 9 or later
- Git

---

## Development Setup

### 1. Clone

```bash
git clone git@github.com:Geanyl17/captureapp.git
cd captureapp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

Open `.env` and set:

```
VITE_SUPABASE_URL=       # from hosting.geanyl.site Supabase project → Settings → API
VITE_SUPABASE_PUBLISHABLE_KEY=   # same place, "anon public" key
VITE_UPLOAD_API_URL=https://hosting.geanyl.site
```

### 4. Run in development

```bash
npm run dev
```

Electron opens with hot-reload. Main process changes require a restart.

---

## Building for distribution

```bash
# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux
```

Output goes to `dist/`. Upload the installer to a GitHub Release and share the link.

### First-run warnings (expected — app is unsigned)

**Windows** — SmartScreen shows "Windows protected your PC".
Click **More info** → **Run anyway**.

**macOS** — Gatekeeper blocks the app on first open.
Go to **System Settings → Privacy & Security → Open Anyway**.

---

## Account setup (for users)

1. Get invited — owner adds your email in the hosting site's Teams page
2. Set your password via the Supabase confirmation email  
3. Open CaptureApp → Settings → sign in with that email + password
4. Done — your uploads appear in your own dashboard at hosting.geanyl.site

---

## Hotkeys (default)

| Action | Windows / Linux | macOS |
|---|---|---|
| Screenshot | Ctrl+Shift+S | Cmd+Shift+S |
| Record | Ctrl+Shift+R | Cmd+Shift+R |

Hotkeys are configurable in Settings.

---

## Auto-updates

The app checks GitHub Releases on startup. When a new version is available it downloads in the background and prompts to restart. To push an update: build, tag a release on GitHub, and upload the installer.

---

## Project structure

```
src/
  main/         Electron main process — tray, shortcuts, IPC, updater
  preload/      Secure bridge between main and renderer
  renderer/     React UI
    src/
      lib/      supabase.ts (auth), upload.ts (API client)
      views/    Editor, Overlay, Settings, History, Record  ← to be built
      App.tsx   Root component + view router
resources/      App icons (icon.icns / icon.ico / icon.png)
```
