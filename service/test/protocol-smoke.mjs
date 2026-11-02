import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexExecutor } from '../codex/executor.mjs';

// Validate the real binary without authentication, inference, or forwarding a turn/start.
const directory = await mkdtemp(join(tmpdir(), 'superagent-protocol-'));
const workspace = join(directory, 'workspace');
const codexHome = join(directory, 'codex-home'), marker = join(directory, 'mcp-started');
let reachedTurn = false;
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
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (line, ...rest) => {
        if (JSON.parse(line).method === 'turn/start') {
          reachedTurn = true;
          throw new Error('PROTOCOL_SMOKE_COMPLETE');
        }
        return write(line, ...rest);
      };
      return child;
    },
  });
  try {
    await executor.execute({ id: 'protocol-smoke', prompt: 'Never forwarded', workspace });
  } catch (error) {
    if (error.message !== 'PROTOCOL_SMOKE_COMPLETE') throw error;
  }
  if (!reachedTurn) throw new Error('Handshake did not reach a validated thread');
  try { await access(marker); throw new Error('Inherited MCP server launched'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('PASS initialize → config/read → thread/start; built-in :workspace, network disabled, on-request and auto_review verified. Inherited MCP sentinel did not launch. No turn sent; no authentication or model call.');
} catch (error) {
  console.error(`Protocol smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
