import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core/store.mjs';
import { Monitor } from '../monitor.mjs';
import { SlackConnector } from '../connectors/slack.mjs';

test('Slack reaction retries survive restart and completion still sends the reply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'superagent-reactions-'));
  let store = new Store(join(dir, 'state.sqlite'));
  const calls = [];
  const slack = new SlackConnector({ appToken: 'app-secret', botToken: 'bot-secret', teamId: 'T1', botUserId: 'UBOT', channelIds: ['C1'], userIds: ['U1'] }, {
    onEvent: async () => {}, fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push([String(url).split('/').pop(), body.name, body.timestamp]);
      if (body.name === 'eyes' && String(url).endsWith('reactions.add')) return new Response('', { status: 429, headers: { 'retry-after': '5' } });
      if (body.name === 'eyes') return Response.json({ ok: false, error: 'no_reaction' });
      if (body.name === 'done') return Response.json({ ok: false, error: 'invalid_name' });
      return Response.json({ ok: true });
    },
  });
  const makeMonitor = () => new Monitor({ store, config: {}, runtime: {}, secrets: {}, slack });
  let monitor = makeMonitor();
  try {
    const { ticket } = store.ingest({ source: 'slack', kind: 'request', id: 'fixture-1', authorized: true, text: 'Inspect fixture',
      teamId: 'T1', channelId: 'C1', messageTs: '14.123', reply: { team: 'T1', channel: 'C1', threadTs: '12.345' } });
    await monitor.flushReactions();
    let pending = store.reactions.listPending({ now: Date.now() + 3600000 });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].attempts, 1);
    assert.equal(pending[0].error, 'Slack reaction failed');
    assert.ok(pending[0].nextAttemptAt > Date.now());
    store.close();
    store = new Store(join(dir, 'state.sqlite'));
    monitor = makeMonitor();
    pending = store.reactions.listPending({ now: Date.now() + 3600000 });
    assert.equal(pending[0].attempts, 1);
    store.updateTicket(ticket.id, { status: 'succeeded', result: 'Fixture complete' });
    await monitor.flushReplies();
    await monitor.flushReactions();
    assert.equal(store.metrics().pendingReplies, 0);
    assert.deepEqual(store.reactions.listPending({ now: Date.now() + 3600000 }), []);
    assert.deepEqual(calls, [
      ['reactions.add', 'eyes', '14.123'],
      ['chat.postMessage', undefined, undefined],
      ['reactions.remove', 'eyes', '14.123'],
      ['reactions.add', 'done', '14.123'],
      ['reactions.add', 'white_check_mark', '14.123'],
    ]);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a late eyes result cannot overwrite a failure, or hold back its reply', async () => {
  const store = new Store(':memory:');
  let release, started;
  const waitForEyes = new Promise(resolve => { release = resolve; });
  const eyesStarted = new Promise(resolve => { started = resolve; });
  const calls = [];
  const slack = new SlackConnector({ appToken: 'app-secret', botToken: 'bot-secret', teamId: 'T1', botUserId: 'UBOT', channelIds: ['C1'], userIds: ['U1'] }, {
    onEvent: async () => {}, fetch: async (url, options) => {
      const body = JSON.parse(options.body), method = String(url).split('/').pop();
      calls.push([method, body.name]);
      if (method === 'reactions.add' && body.name === 'eyes') { started(); await waitForEyes; }
      return Response.json({ ok: true });
    },
  });
  const monitor = new Monitor({ store, config: {}, runtime: {}, secrets: {}, slack });
  try {
    const { ticket } = store.ingest({ source: 'slack', kind: 'request', id: 'fixture-2', authorized: true, text: 'Inspect fixture',
      teamId: 'T1', channelId: 'C1', messageTs: '14.123', reply: { team: 'T1', channel: 'C1', threadTs: '12.345' } });
    const first = monitor.flushReactions();
    await eyesStarted;
    store.updateTicket(ticket.id, { status: 'failed', error: 'fixture failure' });
    await monitor.flushReplies();
    assert.equal(store.metrics().pendingReplies, 0);
    release();
    await first;
    await monitor.flushReactions();
    assert.deepEqual(calls, [
      ['reactions.add', 'eyes'], ['chat.postMessage', undefined], ['reactions.remove', 'eyes'], ['reactions.add', 'x'],
    ]);
    assert.deepEqual(store.reactions.summary(), { pending: 0, failed: 0 });
  } finally { release(); store.close(); }
});
