// @ts-check
const USER = process.env.TERM_USER || 'admin';
const PASS = process.env.TERM_PASS || 'rog2025!';

async function login(page, { user = USER, pass = PASS } = {}) {
  await page.goto('/');
  if (page.url().includes('/login')) {
    await page.fill('input[name="username"], input[type="text"]', user);
    await page.fill('input[name="password"], input[type="password"]', pass);
    await Promise.all([
      page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);
  }
  return page;
}

module.exports = { login, USER, PASS };
