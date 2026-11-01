import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderUserUnit({service,state,node}) {
  for(const value of [service,state,node]) {
    if(typeof value!=='string' || !isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value) || value.split('/').includes('..') || value.trimEnd()!==value || value.endsWith('\\')) throw new Error('Unit paths must be absolute, without control characters, trailing whitespace or parent components');
  }
  if(/[\\*?\[\]]/.test(state)) throw new Error('State path cannot contain glob characters or backslashes');
  // Scalar paths are not unquoted by systemd; words in Environment/ExecStart are.
  const scalar=value=>value.replaceAll('%','%%');
  const q=value=>JSON.stringify(scalar(value));
  const path=[dirname(node),'/usr/local/bin','/usr/bin','/bin'].join(':');
  return `[Unit]\nDescription=Codex Superagent\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${scalar(service)}\nEnvironment=${q('SUPERAGENT_CONFIG='+state+'/config.json')}\nEnvironmentFile=${scalar(state+'/service.env')}\nEnvironment=${q('PATH='+path)}\nExecStart=:${q(node)} ${q(service+'/main.mjs')}\nUMask=0077\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=45\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==5)throw new Error('Usage: node user-unit.mjs SERVICE_DIR STATE_DIR NODE_BINARY');
    const [service,state,node]=process.argv.slice(2);
    process.stdout.write(renderUserUnit({service,state,node}));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
