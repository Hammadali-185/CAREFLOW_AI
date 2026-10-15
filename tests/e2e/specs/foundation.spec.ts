import { expect, test, type Page } from '@playwright/test';

test('account screens stay in the viewport on a phone and a desktop', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('calmer front desk');
  await expectNoHorizontalOverflow(page);

  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  }

  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('main').getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  await expect(page.getByLabel('Clinic slug')).toBeVisible();
  await expect(page.getByLabel('Role')).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}
