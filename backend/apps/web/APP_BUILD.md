# Cutz & Bangs App Build Guide

This app is ready in two forms:

1. PWA install from browser
   - Open `https://cutzandbangs.com/admin/login` on Android Chrome.
   - Tap browser menu → `Install app` / `Add to Home screen`.
   - The installed app opens directly into the staff/admin login flow.

2. Android APK through Capacitor
   - The native app shell loads the live production site: `https://cutzandbangs.com`.
   - This keeps POS, customers, invoices and campaigns connected to the same VPS backend.

## Local Android setup

Install these once on the build machine:

```bash
brew install --cask temurin
brew install --cask android-studio
```

Then open Android Studio once and install:

- Android SDK Platform
- Android SDK Build-Tools
- Android SDK Platform-Tools

## Build commands

From the repo root:

```bash
corepack pnpm --dir backend install
corepack pnpm --dir backend --filter @cutz/web build
corepack pnpm --dir backend --filter @cutz/web android:sync
cd backend/apps/web/android
./gradlew assembleDebug
```

Debug APK output:

```text
backend/apps/web/android/app/build/outputs/apk/debug/app-debug.apk
```

Release APK/AAB should be signed with a real upload key before Play Store use.
