import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderUserUnit } from '../user-unit.mjs';

test('generated unit preserves literal paths with spaces and percent specifiers',t=>{
  const root=mkdtempSync(join(tmpdir(),'superagent-unit-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const service=join(root,'source with spaces %h $VALUE \"quoted\"'),state=join(root,'state with spaces %n $VALUE'),bin=join(root,'node tools %p $VALUE');
  for(const path of [service,state,bin])mkdirSync(path);
  const node=join(bin,'node');symlinkSync(process.execPath,node);
  writeFileSync(join(service,'main.mjs'),'');writeFileSync(join(state,'service.env'),'');
  const unit=renderUserUnit({service,state,node});
  assert.match(unit,/^WorkingDirectory=\//m);
  assert.match(unit,/^EnvironmentFile=\//m);
  assert.match(unit,/source with spaces %%h \$VALUE/m);
  assert.match(unit,/state with spaces %%n \$VALUE/m);
  if(process.platform==='linux' && spawnSync('systemd-analyze',['--version']).status===0){
    const file=join(root,'codex-superagent.service');writeFileSync(file,unit);
    const checked=spawnSync('systemd-analyze',['verify',file],{encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);
    // The host may emit warnings about unrelated installed units.
    assert.doesNotMatch(checked.stderr,/codex-superagent\.service/,checked.stderr);
  } else t.diagnostic('systemd-analyze unavailable; Linux CI verifies the generated unit');
});

test('unit generation rejects relative paths and configuration-line injection',()=>{
  const valid={service:'/opt/example/service',state:'/var/lib/example',node:'/usr/bin/node'};
  for(const key of Object.keys(valid))for(const value of ['relative/path','/tmp/example\nExecStart=/bin/false','/tmp/example\r[Install]','/tmp/example\0value','/tmp/example/../other'])assert.throws(()=>renderUserUnit({...valid,[key]:value}),/path/i);
  for(const state of ['/tmp/example*','/tmp/example?','/tmp/example[one]','/tmp/example\\one'])assert.throws(()=>renderUserUnit({...valid,state}),/path/i);
});
