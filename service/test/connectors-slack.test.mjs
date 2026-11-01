import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SlackConnector } from '../connectors/slack.mjs';

const config = { appToken: 'app-secret', botToken: 'bot-secret', teamId: 'T1', channelIds: ['C1'], userIds: ['U1'], botUserId: 'UBOT' };
const payload = (event, eventId = 'Ev1') => ({ type: 'events_api', body: { team_id: 'T1', event_id: eventId, event } });
const mention = { type: 'app_mention', user: 'U1', channel: 'C1', ts: '12.345', text: '<@UBOT> please help' };
const stubSocket = () => Object.assign(new EventEmitter(), { start: async () => {}, disconnect: async () => {} });

test('Slack acknowledges only after durable intake, deduplicates concurrent retries, preserves thread destination', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const events = [], acks = [];
  const connector = new SlackConnector(config, { socketClient: stubSocket(), onEvent: async event => { events.push(event); await hold; } });
  const one = connector.handleEnvelope({ ...payload(mention), ack: async () => acks.push(1) });
  const two = connector.handleEnvelope({ ...payload(mention), ack: async () => acks.push(2) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(acks.length, 0);
  release();
  await Promise.all([one, two]);
  assert.equal(acks.length, 2);
  assert.equal(events[0].id, 'slack:Ev1');
  assert.equal(events[0].authorized, true);
  assert.equal(events[0].userId, 'U1');
  assert.deepEqual(events[0].reply, { team: 'T1', channel: 'C1', threadTs: '12.345' });
  await connector.handleEnvelope({ ...payload(mention), ack: async () => acks.push(3) });
  assert.equal(events.length, 1);
});

test('Slack ignores bots, unlisted principals and unmentioned unrelated threads; accepts authorized followups', async () => {
  const events = [];
  const connector = new SlackConnector(config, {
    socketClient: stubSocket(), onEvent: async event => events.push(event),
    isThreadAuthorized: async reply => reply.threadTs === '12.345',
  });
  let ackCount = 0;
  const deliver = async (event, id, team = 'T1') => {
    const e = payload(event, id); e.body.team_id = team;
    await connector.handleEnvelope({ ...e, ack: async () => { ackCount++; } });
  };
  await deliver({ ...mention, bot_id: 'B1' }, 'Ev1');
  await deliver({ ...mention, user: 'U2' }, 'Ev2');
  await deliver({ ...mention, channel: 'C2' }, 'Ev3');
  await deliver(mention, 'Ev4', 'T2');
  await deliver({ ...mention, text: 'no mention' }, 'Ev5');
  await deliver({ type: 'message', user: 'U1', channel: 'C1', ts: '13.123', thread_ts: 'unknown', text: 'do work' }, 'Ev6');
  await deliver({ type: 'message', user: 'U1', channel: 'C1', ts: '14.123', thread_ts: '12.345', text: 'follow up' }, 'Ev7');
  assert.equal(ackCount, 7);
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'follow up');
  assert.equal(events[0].reply.threadTs, '12.345');
});

test('Slack leaves failed durable intake unacknowledged and retries it', async () => {
  let attempts = 0, acks = 0;
  const connector = new SlackConnector(config, { socketClient: stubSocket(), onEvent: async () => { if (++attempts === 1) throw new Error('private'); } });
  const envelope = { ...payload(mention), ack: async () => { acks++; } };
  await assert.rejects(connector.handleEnvelope(envelope), /intake failed/);
  assert.equal(acks, 0);
  await connector.handleEnvelope(envelope);
  assert.equal(attempts, 2);
  assert.equal(acks, 1);
});

test('Slack replies are limited to the approved thread and honor Retry-After', async () => {
  const calls = [], sleeps = [];
  const connector = new SlackConnector(config, {
    socketClient: stubSocket(), onEvent: async () => {}, sleep: async ms => sleeps.push(ms),
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : Response.json({ ok: true });
    },
  });
  await connector.send({ team: 'T1', channel: 'C1', threadTs: '12.345' }, 'x'.repeat(5000));
  assert.deepEqual(sleeps, [2000]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.ok(calls.every(call => call.options.headers.authorization === 'Bearer bot-secret'));
  assert.equal(JSON.parse(calls[0].options.body).thread_ts, '12.345');
  assert.ok(JSON.parse(calls[0].options.body).text.length <= 4000);
  await assert.rejects(connector.send({ team: 'T1', channel: 'C2', threadTs: '12.345' }, 'no'), /destination/);
});

test('Slack socket listener dispatches events and long rate limits are returned for durable retry', async () => {
  const socket = stubSocket(), events = [], statuses = [];
  const connector = new SlackConnector(config, {
    socketClient: socket, onEvent: async event => events.push(event), onStatus: status => statuses.push(status),
    fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
  });
  await connector.start();
  let acknowledged = false;
  socket.emit('slack_event', { ...payload(mention), ack: async () => { acknowledged = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(acknowledged, true);
  socket.emit('reconnecting');
  socket.emit('disconnected');
  socket.emit('connected');
  assert.deepEqual(statuses, ['connected', 'reconnecting', 'disconnected', 'connected']);
  await assert.rejects(connector.send({ team: 'T1', channel: 'C1' }, 'CI failed'), error => error.retryAfterMs === 120000);
  await connector.stop();
  assert.equal(socket.listenerCount('slack_event'), 0);
});

test('Slack SDK rejects untrusted socket URLs without connecting', async () => {
  const calls = [];
  const connector = new SlackConnector(config, { onEvent: async () => {}, fetch: async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ ok: true, url: 'wss://evil.example/link?ticket=private' });
  } });
  await assert.rejects(connector.start(), /Slack connection failed/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://slack.com/api/apps.connections.open');
  assert.equal(calls[0].options.redirect, 'error');
});
