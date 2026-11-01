#!/bin/sh
set -eu
[ "$(uname -s)" = Linux ] || { echo 'Run this installer on your Linux VM.' >&2; exit 1; }
command -v systemctl >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
command -v codex >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
systemctl --user show-environment >/dev/null
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
state_dir=${SUPERAGENT_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/codex-superagent}
export SUPERAGENT_CONFIG="$state_dir/config.json"
node_bin=$(command -v node)
codex_bin=$(command -v codex)
cd "$repo_dir/service"
npm ci --omit=dev --ignore-scripts
node test/protocol-smoke.mjs "$codex_bin"
if [ ! -f "$SUPERAGENT_CONFIG" ]; then node main.mjs init; fi
node --input-type=module - "$codex_bin" <<'JS'
import {loadConfig,saveConfig} from './config.mjs';
const config=loadConfig(process.env.SUPERAGENT_CONFIG);
config.codexCommand=process.argv[2];saveConfig(process.env.SUPERAGENT_CONFIG,config);
JS
unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
mkdir -p "$unit_dir"
node --input-type=module - "$repo_dir/service" "$state_dir" "$node_bin" "$unit_dir/codex-superagent.service" <<'JS'
import {writeFileSync} from 'node:fs';
const [service,state,node,file]=process.argv.slice(2);
const q=value=>JSON.stringify(value.replaceAll('%','%%'));
const path=[node.slice(0,node.lastIndexOf('/')),'/usr/local/bin','/usr/bin','/bin'].join(':');
const unit=`[Unit]\nDescription=Codex Superagent\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${q(service)}\nEnvironment=${q('SUPERAGENT_CONFIG='+state+'/config.json')}\nEnvironmentFile=${q(state+'/service.env')}\nEnvironment=${q('PATH='+path)}\nExecStart=${q(node)} ${q(service+'/main.mjs')}\nUMask=0077\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=45\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
writeFileSync(file,unit,{mode:0o600});
JS
systemctl --user daemon-reload
systemctl --user enable --now codex-superagent
systemctl --user is-active codex-superagent
printf 'Service installed. State: %s\nUse an SSH tunnel to VM loopback port 3082. Configure credentials privately in service.env.\n' "$state_dir"
