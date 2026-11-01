#!/bin/sh
set -eu
image=${1:-codex-superagent:dev}
name="superagent-smoke-$$"
volume="$name-data"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker volume create "$volume" >/dev/null
docker run --rm -v "$volume:/data" "$image" node main.mjs init
docker run --rm -v "$volume:/data" "$image" node -e 'const fs=require("node:fs"),p="/data/config.json",c=JSON.parse(fs.readFileSync(p));c.host="0.0.0.0";fs.writeFileSync(p,JSON.stringify(c));'
docker run -d --name "$name" --cap-drop ALL --security-opt no-new-privileges:true -p 127.0.0.1::3082 -v "$volume:/data" "$image" >/dev/null
port=$(docker port "$name" 3082/tcp | sed 's/.*://')
node --input-type=module - "$port" <<'JS'
import assert from 'node:assert/strict';
const base=`http://127.0.0.1:${process.argv[2]}`;
let ready=false;
for(let n=0;n<50;n++){try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
assert.ok(ready,'container health must become ready');
assert.equal((await fetch(base+'/api/status')).status,401);
assert.equal((await fetch(base+'/')).status,200);
console.log('PASS container health, dashboard and unauthorized API rejection');
JS
docker exec "$name" node --env-file=/data/service.env --input-type=module -e 'const r=await fetch("http://127.0.0.1:3082/api/status",{headers:{Authorization:`Bearer ${process.env.SUPERAGENT_ADMIN_TOKEN}`}});const s=await r.json();if(r.status!==200||s.mode!=="observe"||s.metrics.total!==0)process.exit(1);console.log("PASS authenticated empty service status; no model task submitted");'
docker exec "$name" node --env-file=/data/service.env --input-type=module -e 'import {spawnSync} from "node:child_process";const r=spawnSync(process.execPath,["main.mjs"],{encoding:"utf8",timeout:5000});if(r.status===0||!r.stderr.includes("already running"))process.exit(1);console.log("PASS second process rejected before state recovery");'
docker stop --time 10 "$name" >/dev/null
printf 'PASS clean container shutdown. Model sandbox and live integrations require separate checks.\n'
