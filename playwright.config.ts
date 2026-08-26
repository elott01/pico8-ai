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

import { defineConfig, devices } from '@playwright/test';

const PORT = 5174; // not 3000/5173, so a dev server you already have open is left alone
const BASE_URL = `http://localhost:${PORT}`;

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
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
