// The theme control: one icon, the current choice, that opens into Auto, Light and Dark. It
// opens on hover for a mouse and on click, tap or Enter for everyone, because hover alone
// would leave touch and keyboard users with no way to change the theme.

import { test, expect, type Page } from '@playwright/test';

const icon = (page: Page) => page.getByRole('button', { name: /^Colour theme:/ });
const choice = (page: Page, name: 'Auto' | 'Light' | 'Dark') =>
  page.getByRole('button', { name: new RegExp(`^${name} theme`) });

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));
const applied = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

test('it is one icon, named for the current choice', async ({ page }) => {
  await page.goto('/');
  await expect(icon(page)).toHaveAccessibleName('Colour theme: Auto');
  await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(choice(page, 'Dark')).toBeHidden();
});

test.describe('with a mouse and a keyboard', () => {
  test.skip(({ isMobile }) => !!isMobile, 'the touch project has its own test below');

  test('hovering opens it, and moving away closes it', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(choice(page, 'Light')).toBeVisible();
    await page.mouse.move(5, 500);
    await expect(choice(page, 'Light')).toBeHidden();
  });

  test('a click opens it on the current choice, and choosing applies and remembers it', async ({ page }) => {
    await page.goto('/');
    await icon(page).click();
    await expect(choice(page, 'Auto')).toBeFocused();

    await choice(page, 'Dark').click();
    expect(await applied(page)).toBe('dark');
    expect(await stored(page)).toBe('dark');
    await expect(icon(page)).toHaveAccessibleName('Colour theme: Dark');

    // The pre-paint script in index.html applies it before the page draws
    await page.reload();
    expect(await applied(page)).toBe('dark');
    await expect(icon(page)).toHaveAccessibleName('Colour theme: Dark');
  });

  test('Enter opens it, and Escape closes it with focus back on the icon', async ({ page }) => {
    await page.goto('/');
    await icon(page).focus();
    await page.keyboard.press('Enter');
    await expect(choice(page, 'Auto')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(choice(page, 'Auto')).toBeHidden();
    await expect(icon(page)).toBeFocused();
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
  await expect(choice(page, 'Light')).toBeVisible();
  await choice(page, 'Light').tap();
  expect(await applied(page)).toBe('light');
  await expect(choice(page, 'Light')).toBeHidden();
});
