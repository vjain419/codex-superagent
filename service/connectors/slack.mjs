import { boundedInt, credential, requestJson } from './http.mjs';

const id = value => typeof value === 'string' && /^[A-Z0-9]+$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d+\.\d+$/.test(value);
const silentLogger = { debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, getLevel() { return 'error'; } };

export class SlackConnector {
  constructor(config, { fetch: fetchImpl = globalThis.fetch, onEvent, isThreadAuthorized = async () => false, onError = () => {}, onStatus = () => {}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), socketClient } = {}) {
    this.appToken = credential(config.appToken);
    this.botToken = credential(config.botToken);
    if (!id(config.teamId) || !id(config.botUserId) || !Array.isArray(config.channelIds) || !config.channelIds.length || !config.channelIds.every(id) ||
      !Array.isArray(config.userIds) || !config.userIds.length || !config.userIds.every(id) || typeof onEvent !== 'function') throw new Error('Invalid Slack allowlist or intake');
    this.teamId = config.teamId;
    this.botUserId = config.botUserId;
    this.channels = new Set(config.channelIds);
    this.users = new Set(config.userIds);
    this.timeoutMs = boundedInt(config.timeoutMs, 15000, 100, 60000);
    this.fetch = fetchImpl;
    this.onEvent = onEvent;
    this.isThreadAuthorized = isThreadAuthorized;
    this.onError = onError;
    this.onStatus = onStatus;
    this.sleep = sleep;
    this.socket = socketClient;
    this.inflight = new Map();
    this.seen = new Set();
    this.listener = envelope => { this.handleEnvelope(envelope).catch(() => this.onError('Slack intake failed')); };
    this.statusListeners = new Map(['connected', 'reconnecting', 'disconnected', 'error'].map(name => [name, () => this.onStatus(name)]));
  }

  async start() {
    if (!this.socket) {
      const { SocketModeClient } = await import('@slack/socket-mode');
      const safeFetch = async (input, init) => {
        let url;
        try { url = new URL(input); } catch { throw new Error('Invalid Slack API endpoint'); }
        if (url.href !== 'https://slack.com/api/apps.connections.open') throw new Error('Invalid Slack API endpoint');
        const response = await this.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
        if (response.ok) {
          let socketUrl;
          try { socketUrl = new URL((await response.clone().json()).url); } catch { throw new Error('Invalid Slack socket endpoint'); }
          if (socketUrl.protocol !== 'wss:' || !socketUrl.hostname.endsWith('.slack.com') || socketUrl.username || socketUrl.password) throw new Error('Invalid Slack socket endpoint');
        }
        return response;
      };
      this.socket = new SocketModeClient({ appToken: this.appToken, logger: silentLogger, autoReconnectEnabled: true,
        clientOptions: { fetch: safeFetch, retryConfig: { retries: 0 }, timeout: this.timeoutMs } });
    }
    this.socket.on('slack_event', this.listener);
    for (const [name, listener] of this.statusListeners) this.socket.on(name, listener);
    try { await this.socket.start(); this.onStatus('connected'); }
    catch {
      this.socket.off('slack_event', this.listener);
      for (const [name, listener] of this.statusListeners) this.socket.off(name, listener);
      this.onStatus('error');
      throw new Error('Slack connection failed');
    }
  }

  async stop() {
    if (!this.socket) return;
    this.socket.off('slack_event', this.listener);
    for (const [name, listener] of this.statusListeners) this.socket.off(name, listener);
    await this.socket.disconnect();
  }

  async handleEnvelope({ type, body, ack }) {
    if (typeof ack !== 'function') throw new Error('Invalid Slack envelope');
    if (type !== 'events_api') { await ack(); return; }
    const event = body?.event;
    const mention = `<@${this.botUserId}>`;
    if (!event || !['app_mention', 'message'].includes(event.type) || !body?.event_id || typeof body.event_id !== 'string' || body.event_id.length > 200 ||
      body.team_id !== this.teamId || !this.channels.has(event.channel) || !this.users.has(event.user) || event.user === this.botUserId || event.bot_id || event.bot_profile || event.subtype ||
      !timestamp(event.ts) || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 12000) { await ack(); return; }
    const reply = { team: this.teamId, channel: event.channel, threadTs: event.thread_ts || event.ts };
    if (!timestamp(reply.threadTs)) { await ack(); return; }
    if (event.type === 'app_mention') {
      if (!event.text.includes(mention)) { await ack(); return; }
    } else {
      if (!event.thread_ts || event.text.includes(mention)) { await ack(); return; }
      let allowed;
      try { allowed = await this.isThreadAuthorized(reply); } catch { throw new Error('Slack intake failed'); }
      if (!allowed) { await ack(); return; }
    }
    const eventId = `slack:${body.event_id}`;
    if (!this.seen.has(eventId)) {
      let pending = this.inflight.get(eventId);
      if (!pending) {
        const intake = { id: eventId, source: 'slack', kind: 'request', text: event.text, authorized: true,
          teamId: this.teamId, channelId: event.channel, userId: event.user, messageTs: event.ts, reply };
        pending = Promise.resolve().then(() => this.onEvent(intake)).then(() => {
          this.seen.add(eventId);
          if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value);
        }).finally(() => this.inflight.delete(eventId));
        this.inflight.set(eventId, pending);
      }
      try { await pending; } catch { throw new Error('Slack intake failed'); }
    }
    try { await ack(); } catch { throw new Error('Slack acknowledgement failed'); }
  }

  async send(destination, text) {
    if (!destination || destination.team !== this.teamId || !this.channels.has(destination.channel) ||
      (destination.threadTs !== undefined && !timestamp(destination.threadTs))) throw new Error('Invalid Slack destination');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid Slack message');
    const chars = Array.from(text);
    const boundedText = chars.length > 4000 ? `${chars.slice(0, 3999).join('')}…` : text;
    const body = { channel: destination.channel, text: boundedText, unfurl_links: false, unfurl_media: false };
    if (destination.threadTs) body.thread_ts = destination.threadTs;
    const options = { method: 'POST', headers: { authorization: `Bearer ${this.botToken}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await requestJson(this.fetch, 'https://slack.com/api/chat.postMessage', options, this.timeoutMs);
        if (response.body?.ok !== true) throw new Error('Slack rejected message');
        return;
      } catch (error) {
        if (error.status === 429 && attempt === 0 && error.retryAfterMs > 0 && error.retryAfterMs <= 30000) { await this.sleep(error.retryAfterMs); continue; }
        const failure = new Error('Slack send failed');
        if (Number.isFinite(error.retryAfterMs)) failure.retryAfterMs = error.retryAfterMs;
        throw failure;
      }
    }
  }
}
