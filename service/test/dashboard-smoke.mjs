import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { defaults, loadConfig, saveConfig } from '../config.mjs';

// Optional browser check: pass an installed Playwright module path; requires Chrome.
const { chromium } = await import(process.argv[2] ?? 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'superagent-dashboard-'));
const file = join(directory, 'config.json'), token = 'fixture-admin-token-'.repeat(3);
const config = defaults(directory);
saveConfig(file, config);
const server = createServer({
  config, adminToken: token,
  store: { metrics: () => ({}), listTickets: () => [] },
  updateConfig: async next => saveConfig(file, next),
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('Admin token').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  const editor = page.getByLabel('Operational settings');
  const saved = JSON.parse(await editor.inputValue());
  await editor.fill(JSON.stringify({ ...saved, pollSeconds: 5 }));
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Validate & save' }).click();
  assert.equal((await rejected).status(), 400);
  const feedback = page.locator('#configuration [role="status"]');
  await feedback.waitFor({ state: 'visible', timeout: 2000 });
  assert.match(await feedback.textContent(), /save not confirmed.*pollSeconds/is);
  let box = await feedback.boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 720, 'Save feedback must be in the viewport');
  assert.equal(loadConfig(file).pollSeconds, 60, 'Rejected settings must not reach disk');

  await editor.fill(JSON.stringify({ ...saved, pollSeconds: 61 }));
  const accepted = page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Validate & save' }).click();
  assert.equal((await accepted).status(), 200);
  await page.waitForFunction(() => document.querySelector('#configuration [role="status"]').textContent.startsWith('Saved'));
  assert.match(await feedback.textContent(), /restart/i);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).pollSeconds, 61);
  await page.reload();
  await page.getByLabel('Admin token').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#config').value.includes('61'));
  assert.equal(JSON.parse(await editor.inputValue()).pollSeconds, 61);
  // A dropped save response must leave the draft intact and restore the button.
  const draft = JSON.stringify({ ...saved, pollSeconds: 62 });
  await editor.fill(draft);
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/api/config', async route => {
    await hold;
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: 'Validate & save' }).click();
  assert.equal(await page.getByRole('button', { name: 'Saving…' }).isDisabled(), true);
  release();
  await page.waitForFunction(() => document.querySelector('#config-notice').textContent.includes('Cannot reach'));
  assert.match(await feedback.textContent(), /save not confirmed/i);
  assert.equal(await editor.inputValue(), draft);
  assert.equal(loadConfig(file).pollSeconds, 61);
  assert.equal(await page.getByRole('button', { name: 'Validate & save' }).isEnabled(), true);
  box = await feedback.boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= 720, 'Connection errors must be in the viewport');
  console.log('PASS visible validation and connection errors, saving indicator, preserved drafts, save/restart feedback, disk persistence and reload.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
