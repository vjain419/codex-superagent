import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Slack manifest enables public thread followups and reactions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../slack-manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.oauth_config.scopes.bot.includes('reactions:write'));
  assert.ok(manifest.oauth_config.scopes.bot.includes('channels:history'));
  assert.ok(manifest.settings.event_subscriptions.bot_events.includes('message.channels'));
});
