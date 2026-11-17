// Browser tests. Separate from `npm test` on purpose: that suite is node:test only, runs in
// ~3s and needs nothing. This one boots a server and drives real engines.
//
// Chromium AND WebKit, not just Chromium. That is the whole reason this exists: the cart
// switcher was keyboard-unreachable in Safari for a week while passing every Chromium check,
// because WebKit omits buttons from the tab order by default. A single-engine suite would
// have stayed green through the entire bug.
//
// `npm run dev` (Vite alone) is enough — no `vercel dev`, no GEMINI_API_KEY, no quota. The
// carts are static files, and the one test that needs a model response stubs `/api/move` in
// the page. That keeps this runnable by anyone who clones the repo, and cheap in CI.

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 5174; // not 3000/5173, so a dev server you already have open is left alone
const BASE_URL = `http://localhost:${PORT}`;

// Firefox needs two things the other engines don't, both handed to it as environment.
//
// Its fullscreen fills the screen, where Chromium and WebKit keep the viewport, and a headless
// Firefox's screen is 1366 x 768. fullscreen.spec.ts measures the game against a 1728 x 1086
// window, so the screen is made that size. PICO-8 drew 768 there before, which was right for
// that screen.
//
// On macOS 27 it hangs at launch, a core at 100% for each worker until the launch times out.
// Its app data resolves to ~/Library/Application Support/Firefox, which macOS 27 protects, and
// headless Firefox spins on a "Profile Missing" dialog it can't draw. App data of its own lets
// it start. Fixed upstream in Firefox 158 (microsoft/playwright#42768): drop it once Playwright
// bundles 158 or later. The timeout makes any hang fail in 30s rather than spin for minutes.
const firefoxAppData = join(tmpdir(), 'pico-ai-playwright-firefox');
const onMac = process.platform === 'darwin';
if (onMac) mkdirSync(firefoxAppData, { recursive: true });
//
// On a Linux machine with no GPU, as in CI, it refuses WebGL: the only GL there is Mesa's software
// one, which Firefox blocks. The CRT filter then never draws and crt.spec fails throughout, so
// the block is lifted. Chromium and WebKit use software GL there without being asked.
const firefoxLaunch = {
  timeout: 30_000,
  firefoxUserPrefs: { 'webgl.force-enabled': true },
  env: {
    ...process.env,
    MOZ_HEADLESS_WIDTH: '1728',
    MOZ_HEADLESS_HEIGHT: '1086',
    ...(onMac ? { MOZ_APP_DATA: firefoxAppData, MOZ_LOCAL_APP_DATA: firefoxAppData } : {}),
  },
};

export default defineConfig({
  testDir: './playwright',
  // Cart switches involve a 1.6MB runtime load; the default 5s expect timeout is tight.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The engine that found the bug this suite exists to prevent.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Real touch emulation — hasTouch and a mobile viewport, not just a narrow window.
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: firefoxLaunch } },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
