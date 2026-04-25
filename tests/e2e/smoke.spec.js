// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('Smoke', () => {
  test('server alive (302/200 on /)', async ({ request }) => {
    const r = await request.get('/');
    expect([200, 302, 304]).toContain(r.status());
  });

  test('login page reachable', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('login + main shell loads', async ({ page }) => {
    await login(page);
    await expect(page).toHaveTitle(/CYBERFRAME|Web Terminal|Claude/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('REST: GET /api/claude/sessions', async ({ request }) => {
    const r = await request.get('/api/claude/sessions');
    expect([200, 401, 403]).toContain(r.status());
  });
});
