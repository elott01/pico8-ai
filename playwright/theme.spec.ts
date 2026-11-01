// The theme control: one icon, the current choice, that opens sideways into Auto, Light and
// Dark. A mouse opens it by resting on it and closes it by leaving. A click, tap or Enter
// opens it too, and then a choice closes it.

import { test, expect, type Page } from '@playwright/test';

const icon = (page: Page) => page.getByRole('button', { name: /^Colour theme:/ });
const choice = (page: Page, name: 'Auto' | 'Light' | 'Dark') =>
  page.getByRole('button', { name: new RegExp(`^${name} theme`) });
const link = (page: Page, name: RegExp) =>
  page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name });
const about = (page: Page) => link(page, /^About/);
const source = (page: Page) => link(page, /^Source/);

const stored = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));
const applied = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

test('it is one icon, named for the current choice', async ({ page }) => {
  await page.goto('/');
  await expect(icon(page)).toHaveAccessibleName('Colour theme: Auto');
  await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
});

// A mouse opens it just by resting there, so it mustn't shift anything else in the header:
// a link that moved then would move under a pointer that hadn't asked for anything.
test('it opens sideways and moves nothing else in the header', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const boxes = () =>
    Promise.all([page.locator('header').boundingBox(), about(page).boundingBox(), source(page).boundingBox()]);
  const before = await boxes();
  const pill = icon(page).locator('..');

  await icon(page).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await pill.boundingBox())?.width).toBe(134);

  const open = (await pill.boundingBox())!;
  const header = before[0]!;
  expect(await boxes()).toEqual(before);
  expect(open.x + open.width).toBeLessThanOrEqual(header.x + header.width);
});

test.describe('with a mouse and a keyboard', () => {
  test.skip(({ isMobile }) => !!isMobile, 'the touch project has its own test below');

  // Focus staying put matters most when it is in the cart: that is where its keys go.
  test('resting the mouse on it opens it without moving focus, and leaving closes it', async ({ page }) => {
    await page.goto('/');
    await about(page).focus();

    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(about(page)).toBeFocused();

    await page.mouse.move(0, 0);
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
  });

  // The pill stops just short of the link's first letter, further short on a big window, so
  // covering it isn't enough: a sliver of it would show.
  test('open, it lies over the Source link, which fades until it closes', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(source(page)).toHaveCSS('opacity', '0');

    const box = (await source(page).boundingBox())!;
    const under = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('a') ?? null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(under).toBeNull();

    await page.mouse.move(0, 0);
    await expect(source(page)).toHaveCSS('opacity', '1');
  });

  test('on a narrow window it grows into the room after the links, and leaves them showing', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1200 });
    await page.goto('/');
    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(source(page)).toHaveCSS('opacity', '1');
  });

  test('crossing it on the way past leaves it closed', async ({ page }) => {
    await page.goto('/');
    const box = (await icon(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(0, 0);

    await page.waitForTimeout(200);
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
  });

  // Opening slides the icons along, so without this a click meant for the icon would land on
  // whichever choice had slid under the pointer. Clicking the moment it opens, from inside
  // the page, because a click from out here can't be timed that closely.
  test('a click as it opens does nothing, and one after it has settled chooses', async ({ page }) => {
    await page.goto('/');
    await icon(page).evaluate((trigger) => {
      new MutationObserver((_, observer) => {
        observer.disconnect();
        document.querySelector<HTMLElement>('[aria-label="Dark theme"]')!.click();
      }).observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
    });

    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await applied(page)).toBeNull();

    await page.waitForTimeout(300);
    await choice(page, 'Dark').click();
    expect(await applied(page)).toBe('dark');
  });

  test('opened by the mouse, it stays through a choice, showing it move, until the mouse leaves', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(300);

    await choice(page, 'Dark').click();
    await expect(choice(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

    await choice(page, 'Light').click();
    expect(await applied(page)).toBe('light');
    await expect(choice(page, 'Light')).toHaveAttribute('aria-pressed', 'true');

    await page.mouse.move(0, 0);
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
  });

  // Opening leaves the mouse on whichever icon slid there, and the current choice's fill says
  // nothing about what a click on it would do.
  test('the choice under the mouse is filled, and the others are not', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

    await choice(page, 'Light').hover();
    const clear = 'rgba(0, 0, 0, 0)';
    await expect(choice(page, 'Light')).not.toHaveCSS('background-color', clear);
    await expect(choice(page, 'Dark')).toHaveCSS('background-color', clear);
  });

  test('Escape closes it when the mouse opened it too, and leaves focus where it was', async ({ page }) => {
    await page.goto('/');
    await about(page).focus();
    await icon(page).hover();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(about(page)).toBeFocused();
  });

  test('focus landing on the link under it closes it', async ({ page }) => {
    await page.goto('/');
    await icon(page).hover();
    await expect(source(page)).toHaveCSS('opacity', '0');

    await source(page).focus();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(source(page)).toHaveCSS('opacity', '1');
  });

  test('opened by a click, it stays open after the mouse leaves', async ({ page }) => {
    await page.goto('/');
    await icon(page).click();
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('a click opens it on the current choice, and choosing applies and remembers it', async ({ page }) => {
    await page.goto('/');
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

  // In Chromium a link takes focus on the press, so a slow click has the pill close before the
  // release. A link that moved then would never get the click.
  for (const opener of ['click', 'hover'] as const) {
    test(`a click elsewhere closes it, and a slow one still lands (${opener})`, async ({ page }) => {
      await page.goto('/');
      await about(page).evaluate((a) =>
        a.addEventListener('click', (event) => {
          event.preventDefault();
          a.dataset.followed = 'yes';
        }),
      );
      await icon(page)[opener]();
      await expect(icon(page)).toHaveAttribute('aria-expanded', 'true');

      // Longer than the mouse may stray, so a hover's close comes due during the press
      await about(page).click({ delay: 250 });
      await expect(about(page)).toHaveAttribute('data-followed', 'yes');
      await expect(icon(page)).toHaveAttribute('aria-expanded', 'false');
    });
  }

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
