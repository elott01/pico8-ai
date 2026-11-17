// The About section under the arcade, and the header's link to it.
//
// About comes after the cart in the DOM, and the cart's iframe swallows Tab, so Tab alone can
// never reach it from the top of the page. The header's About link is the way in: following
// it moves the browser's Tab starting point to the section.

import { test, expect } from '@playwright/test';

const about = '#about';

test('the header’s links are in the tab order', async ({ page, isMobile }) => {
  test.skip(isMobile, 'tab order is the webkit project’s to check; this is the same engine');
  await page.goto('/');
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim()));
  }
  // WebKit leaves links out of the tab order unless they carry tabIndex={0}
  expect(seen[0]).toBe('About');
  expect(seen[1]).toMatch(/^Source/);
});

test('the About link jumps to the section, and Tab carries on from there', async ({ page, isMobile }) => {
  test.skip(isMobile, 'tab order is the webkit project’s to check; this is the same engine');
  await page.goto('/');
  await page.getByRole('link', { name: 'About', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#about$/);
  await expect(page.locator(about)).toBeInViewport();

  await page.keyboard.press('Tab');
  const inside = await page.evaluate((selector) => !!document.activeElement?.closest(selector), about);
  expect(inside).toBe(true);
});

test('every link that leaves the site opens a new tab and says so', async ({ page }) => {
  await page.goto('/');
  const links = await page.locator(`${about} a`).all();
  expect(links.length).toBeGreaterThan(0);

  for (const link of links) {
    const href = (await link.getAttribute('href')) ?? '';
    // A link Ethan hasn't filled in is left out, never rendered empty
    expect(href).not.toBe('');
    if (href.startsWith('mailto:')) {
      await expect(link).not.toHaveAttribute('target', '_blank');
    } else {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
    }
  }
  // The repo is always there, whatever else is filled in
  await expect(page.locator(about).getByRole('link', { name: /^Source/ })).toHaveAttribute(
    'href',
    'https://github.com/elott01/pico8-ai',
  );
});

test('the chain lists the five steps a move takes, cart to Gemini', async ({ page }) => {
  await page.goto('/');
  const steps = page.getByRole('list', { name: /How a move travels/ }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  await expect(steps.first()).toContainText('PICO-8 cart');
  await expect(steps.last()).toContainText('Gemini');
});
