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
import { GPU } from './playwright/_ci.ts';

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
const firefoxLaunch = {
  timeout: 30_000,
  env: {
    ...process.env,
    MOZ_HEADLESS_WIDTH: '1728',
    MOZ_HEADLESS_HEIGHT: '1086',
    ...(onMac ? { MOZ_APP_DATA: firefoxAppData, MOZ_LOCAL_APP_DATA: firefoxAppData } : {}),
  },
};

// In CI, the tests that read what the CRT shader drew run in Chromium only. CI's machines have
// no GPU, so in the other engines those tests measured the machine: Firefox had no WebGL at all,
// and WebKit on the Mac runner moved a picture that holds still on a real Mac. They still run in
// every engine locally. The tag is on the tests, from playwright/_ci.ts.
const gpuInChromiumOnly = process.env.CI ? { grepInvert: new RegExp(GPU.tag) } : {};

export default defineConfig({
  testDir: './playwright',
  // Cart switches involve a 1.6MB runtime load; the default 5s expect timeout is tight.
  expect: { timeout: 10_000 },
  // A cart may take BOOT_MS (30s) to boot in CI, the whole of a test's default time, so a test
  // there gets twice that. A desktop boots one in a second or two.
  timeout: process.env.CI ? 60_000 : 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The engine that found the bug this suite exists to prevent.
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, ...gpuInChromiumOnly },
    // Real touch emulation — hasTouch and a mobile viewport, not just a narrow window.
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] }, ...gpuInChromiumOnly },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: firefoxLaunch },
      ...gpuInChromiumOnly,
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
