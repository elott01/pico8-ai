// The theme control: one icon, the current choice, that opens sideways into Auto, Light and
// Dark. It opens on click, tap or Enter, and not on hover: opening slides the icons along, so
// a click just after a hover would land on whichever one had slid under the pointer.

import { test, expect, type Page } from '@playwright/test';

const icon = (page: Page) => page.getByRole('button', { name: /^Colour theme:/ });
const choice = (page: Page, name: 'Auto' | 'Light' | 'Dark') =>
  page.getByRole('button', { name: new RegExp(`^${name} theme`) });
const source = (page: Page) =>
  page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: /^Source/ });

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));
const applied = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

test('it is one icon, named for the current choice', async ({ page }) => {
  await page.goto('/');
  await expect(icon(page)).toHaveAccessibleName('Colour theme: Auto');
  await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
});

// The pill is in the header's flow, so it moves the links rather than covering them. If the
// header ever lacked the room, opening would re-wrap it and shift the page under the pointer.
test('it opens sideways, moving the links along without re-wrapping the header', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const header = await page.locator('header').boundingBox();
  const pill = icon(page).locator('..');

  await icon(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await pill.boundingBox())?.width).toBe(134);

  const open = (await pill.boundingBox())!;
  const link = (await source(page).boundingBox())!;
  expect((await page.locator('header').boundingBox())!.height).toBe(header!.height);
  expect(link.x + link.width).toBeLessThanOrEqual(open.x);
  expect(open.x + open.width).toBeLessThanOrEqual(header!.x + header!.width);
});

test.describe('with a mouse and a keyboard', () => {
  test.skip(({ isMobile }) => !!isMobile, 'the touch project has its own test below');

  test('a click opens it on the current choice, and choosing applies and remembers it', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');

    await icon(page).click();
    await expect(choice(page, 'Auto')).toBeFocused();

    await choice(page, 'Dark').click();
    expect(await applied(page)).toBe('dark');
    expect(await stored(page)).toBe('dark');
    await expect(icon(page)).toHaveAccessibleName('Colour theme: Dark');
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');

    // The pre-paint script in index.html applies it before the page draws
    await page.reload();
    expect(await applied(page)).toBe('dark');
    await expect(icon(page)).toHaveAccessibleName('Colour theme: Dark');
  });

  test('closed, Tab goes past the three; Enter opens it, and Escape closes it onto the icon', async ({ page }) => {
    await page.goto('/');
    await icon(page).focus();
    await page.keyboard.press('Tab');
    for (const name of ['Auto', 'Light', 'Dark'] as const) {
      await expect(choice(page, name)).not.toBeFocused();
    }

    await icon(page).focus();
    await page.keyboard.press('Enter');
    await expect(choice(page, 'Auto')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(icon(page)).toBeFocused();
  });

  // Closing slides the links back, and in Chromium a link takes focus on the press. Were the
  // pill to close on that, the link would move out from under a human-speed click before the
  // release, and the click would never reach it.
  test('a click elsewhere closes it, even a slow one on a link it had pushed aside', async ({ page }) => {
    await page.goto('/');
    await source(page).evaluate((a) =>
      a.addEventListener('click', (event) => {
        event.preventDefault();
        a.dataset.followed = 'yes';
      }),
    );
    await icon(page).click();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

    await source(page).click({ delay: 150 });
    await expect(source(page)).toHaveAttribute('data-followed', 'yes');
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Auto clears the stored choice, so the OS decides again', async ({ page }) => {
    await page.goto('/');
    await icon(page).click();
    await choice(page, 'Light').click();
    expect(await stored(page)).toBe('light');

    await icon(page).click();
    await choice(page, 'Auto').click();
    expect(await stored(page)).toBeNull();
    expect(await applied(page)).toBeNull();
  });
});

test('a tap opens it on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'needs a touch-enabled context');
  await page.goto('/');
  await icon(page).tap();
  await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
  await choice(page, 'Light').tap();
  expect(await applied(page)).toBe('light');
  await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
});
