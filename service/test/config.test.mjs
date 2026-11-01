import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaults, validateConfig, saveConfig, loadConfig, resolveSecrets } from '../config.mjs';

test('defaults are safe and resolve local paths', () => {
  const c = defaults('/tmp/superagent');
  assert.equal(c.mode, 'observe');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.slack.enabled, false);
  assert.deepEqual(c.gerrit, []);
  assert.equal(validateConfig(c), c);
});
test('Gerrit uses explicit project allowlists and environment-backed credentials, while old config stays valid', () => {
  const c=defaults('/tmp/superagent');
  const gerrit={id:'review',baseUrl:'https://gerrit.example.test',usernameEnv:'GERRIT_USER',tokenEnv:'GERRIT_TOKEN',projects:['team/project']};
  assert.equal(validateConfig({...c,gerrit:[gerrit]}).gerrit.length,1);
  const old={...c};delete old.gerrit;
  assert.equal(validateConfig(old),old);
  const resolved=resolveSecrets({...c,gerrit:[gerrit]},{SUPERAGENT_ADMIN_TOKEN:'admin-test-token-123456789012345678',GERRIT_USER:'reader',GERRIT_TOKEN:'secret'});
  assert.equal(resolved.gerrit[0].username,'reader');
  assert.equal(resolved.gerrit[0].token,'secret');
  assert.throws(()=>validateConfig({...c,gerrit:[{...gerrit,projects:['^team/.*']}]}),/project/);
  assert.throws(()=>validateConfig({...c,gerrit:[{...gerrit,projects:[]}]}),/project/);
  assert.throws(()=>validateConfig({...c,gerrit:[{...gerrit,maxPages:21}]}),/maxPages/);
  assert.throws(()=>validateConfig({...c,gerrit:[{...gerrit,timeoutMs:99}]}),/timeoutMs/);
});
test('doctor reports configured Gerrit integration without printing credentials', () => {
  const dir=mkdtempSync(join(tmpdir(),'superagent-doctor-'));
  try {
    const file=join(dir,'config.json'),c=defaults(dir);
    c.codexCommand=process.execPath;
    c.gerrit=[{id:'review',baseUrl:'https://gerrit.example.test',usernameEnv:'GERRIT_USER',tokenEnv:'GERRIT_TOKEN',projects:['team/project']}];
    saveConfig(file,c);
    const output=execFileSync(process.execPath,[fileURLToPath(new URL('../main.mjs',import.meta.url)),'doctor'],{encoding:'utf8',env:{...process.env,SUPERAGENT_CONFIG:file,SUPERAGENT_ADMIN_TOKEN:'admin-test-token-123456789012345678',GERRIT_USER:'reader',GERRIT_TOKEN:'private-test-token'}});
    assert.equal(JSON.parse(output).integrations.gerrit,1);
    assert.doesNotMatch(output,/private-test-token/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('rejects executable paths from web configuration and malformed provider URLs', () => {
  const c = defaults('/tmp/superagent');
  assert.throws(() => validateConfig({ ...c, mode: 'anything' }));
  assert.throws(() => validateConfig({ ...c, port: 0 }));
  assert.throws(() => validateConfig({ ...c, unknownSecret: 'no' }));
  assert.throws(() => validateConfig({ ...c, github: [{ id: 'g', baseUrl: 'https://user:pass@example.test', tokenEnv:'GITHUB_TOKEN', repositories: [{owner:'a',repo:'b'}] }] }));
  assert.throws(() => validateConfig({ ...c, slack: { ...c.slack, enabled: true } }));
});
test('config uses named secret references and atomically preserves private file mode', () => {
  const dir=mkdtempSync(join(tmpdir(),'superagent-config-'));
  try {
    const file=join(dir,'config.json'), c=defaults(dir);
    saveConfig(file,c);
    assert.equal(statSync(file).mode & 0o777,0o600);
    assert.deepEqual(loadConfig(file),c);
    assert.ok(!readFileSync(file,'utf8').includes('private-test-token'));
    c.slack={...c.slack,enabled:true,teamId:'T1',channelIds:['C1'],userIds:['U1'],botUserId:'B1'};
    assert.throws(()=>resolveSecrets(c,{SUPERAGENT_ADMIN_TOKEN:"admin-test-token-123456789012345678"}),/SLACK_APP_TOKEN/);
    const resolved=resolveSecrets(c,{SLACK_APP_TOKEN:'private-test-token',SLACK_BOT_TOKEN:'bot-test-token',SUPERAGENT_ADMIN_TOKEN:'admin-test-token-123456789012345678'});
    assert.equal(resolved.slack.appToken,'private-test-token');
    assert.equal(c.slack.appToken,undefined);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
