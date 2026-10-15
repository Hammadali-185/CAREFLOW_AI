import { expect, test, type Page } from '@playwright/test';

const password = 'CorrectHorse!2026';

test('a patient can register, book, move, and cancel a visit', async ({ page }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@patient.example`;
  const bookDate = upcomingWeekday(testInfo.project.name === 'desktop' ? 2 : 4, 3);
  const movedDate = addDays(bookDate, 7);

  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Patient');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Clinic slug').fill('harbor-light');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, E2E Patient' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/assistant');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Book a follow-up tomorrow morning');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'The scheduling assistant is not configured. You can book from the form.',
  );
  await expect(page.getByText('Your visit is booked')).toHaveCount(0);

  await page.goto('/book');
  await expect(page.getByRole('heading', { name: 'Book a visit' })).toBeVisible();
  await page.getByLabel('Service').selectOption({ label: 'Follow-up visit (20 min)' });
  await page.getByLabel('Date').fill(bookDate);
  const slot = page.getByRole('button', { name: /Ali Subhan|Hamza Qureshi/ }).first();
  await expect(slot).toBeVisible();
  await slot.click();
  await page.getByRole('button', { name: 'Review booking' }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your visit is booked' })).toBeVisible();

  await page.getByRole('link', { name: 'View your visits' }).click();
  await expect(page).toHaveURL(/\/visits$/);
  await page.getByRole('button', { name: 'Reschedule' }).first().click();
  await page.getByLabel('Date').fill(movedDate);
  const nextSlot = page.getByRole('button', { name: /Ali Subhan|Hamza Qureshi/ }).first();
  await expect(nextSlot).toBeVisible();
  await nextSlot.click();
  await page.getByRole('button', { name: 'Confirm new time' }).click();
  await expect(page.getByRole('button', { name: 'Confirm new time' })).toHaveCount(0);
  await expect(page.getByText('That change did not go through')).toHaveCount(0);
  const movedLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${movedDate}T16:00:00.000Z`));
  await expect(page.getByText(movedLabel).first()).toBeVisible();

  await page.getByRole('button', { name: 'Cancel visit' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this visit?' });
  await dialog.getByRole('button', { name: 'Cancel visit' }).click();
  await page.getByRole('button', { name: 'Past' }).click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, E2E Patient' })).toBeVisible();
  await page.goto('/visits');
  await page.getByRole('button', { name: 'Past' }).click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
});

test('the clinic desk stays in the viewport', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('hamza.qureshi@harbor-light.example');
  await page.getByLabel('Password').fill('DemoCareflow!2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Clinic desk' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

function upcomingWeekday(target: number, extraDays: number) {
  const civil = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = civil.split('-').map(Number);
  const cursor = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  cursor.setUTCDate(cursor.getUTCDate() + extraDays);
  for (let step = 0; step < 21; step += 1) {
    if (cursor.getUTCDay() === target) {
      return cursor.toISOString().slice(0, 10);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error('No bookable weekday in range.');
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const cursor = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}
