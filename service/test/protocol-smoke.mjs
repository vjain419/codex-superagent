import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexExecutor } from '../codex/executor.mjs';

// Validate the real binary without authentication, inference, or forwarding a turn/start.
const directory = await mkdtemp(join(tmpdir(), 'superagent-protocol-'));
const workspace = join(directory, 'workspace');
const codexHome = join(directory, 'codex-home'), marker = join(directory, 'mcp-started');
let reachedTurns = 0, session, expectedMethod = 'thread/start', controller;
const methods = [];
try {
  await mkdir(workspace);
  await mkdir(codexHome);
  const sentinel = join(directory, 'mcp-sentinel.mjs');
  await writeFile(sentinel, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  await writeFile(join(codexHome, 'config.toml'), `[mcp_servers.sentinel]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(sentinel)}]\nenabled = true\n`);
  const executor = new CodexExecutor({
    command: process.argv[2] ?? 'codex',
    codexHome,
    timeoutMs: 20000,
    env: { PATH: process.env.PATH },
    spawn(command, args, options) {
      const child = spawn(command, args, options);
      let injectedId, buffer = '';
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (injectedId != null && message.id === injectedId) controller.abort(new Error(message.error ? `Fixture persistence failed: ${message.error.message}` : 'PROTOCOL_SMOKE_COMPLETE'));
        }
      });
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (line, ...rest) => {
        const message = JSON.parse(line);
        methods.push(message.method);
        if (message.method === 'turn/start') {
          reachedTurns++;
          if (expectedMethod === 'thread/start') {
            injectedId = message.id;
            // A started thread has no rollout until history exists; persist only synthetic text.
            return write(JSON.stringify({id: message.id, method: 'thread/inject_items', params: {threadId: message.params.threadId, items: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Protocol smoke fixture; no model call.'}]}]}}) + '\n', ...rest);
          }
          throw new Error('PROTOCOL_SMOKE_COMPLETE');
        }
        return write(line, ...rest);
      };
      return child;
    },
  });
  for (const resumed of [false, true]) {
    expectedMethod = resumed ? 'thread/resume' : 'thread/start';
    methods.length = 0;
    controller = new AbortController();
    try {
      await executor.execute({ id: 'protocol-smoke', prompt: 'Never forwarded', workspace, signal: controller.signal, ...(resumed ? { threadId: session?.threadId, totalUsage: session?.totalUsage } : {}) }, () => {}, value => { session = value; });
    } catch (error) {
      if (error.message !== 'PROTOCOL_SMOKE_COMPLETE') throw error;
    }
    if (!session?.threadId || !methods.includes(expectedMethod) || methods.includes(resumed ? 'thread/start' : 'thread/resume')) throw new Error(`Handshake did not validate ${expectedMethod}`);
  }
  if (reachedTurns !== 2) throw new Error('Start and resume did not both reach a validated thread');
  try { await access(marker); throw new Error('Inherited MCP server launched'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('PASS initialize → config/read → thread/start → restart → thread/resume; same workspace/session, built-in :workspace, network disabled, on-request and auto_review verified. Inherited MCP sentinel did not launch. Synthetic history persisted through thread/inject_items. Both turn/start requests intercepted. No turn sent; no authentication or model call.');
} catch (error) {
  console.error(`Protocol smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
