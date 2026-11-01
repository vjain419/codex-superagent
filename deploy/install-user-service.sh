#!/bin/sh
set -eu
umask 077
[ "$(uname -s)" = Linux ] || { echo 'Run this installer on your Linux VM.' >&2; exit 1; }
command -v systemctl >/dev/null
command -v systemd-analyze >/dev/null
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
unit_temp=$(mktemp --suffix=.service "$unit_dir/codex-superagent-XXXXXX")
trap 'rm -f "$unit_temp"' 0
node "$repo_dir/deploy/user-unit.mjs" "$repo_dir/service" "$state_dir" "$node_bin" > "$unit_temp"
systemd-analyze --user verify "$unit_temp"
mv -f -- "$unit_temp" "$unit_dir/codex-superagent.service"

systemctl --user daemon-reload
systemctl --user enable --now codex-superagent
systemctl --user is-active codex-superagent
printf 'Service installed. State: %s\nUse an SSH tunnel to VM loopback port 3082. Configure credentials privately in service.env.\n' "$state_dir"
