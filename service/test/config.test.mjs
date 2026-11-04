import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaults, validateConfig, saveConfig, loadConfig, resolveSecrets } from '../config.mjs';
import { pollGithub, pollJenkins } from '../connectors/ci.mjs';
import { SlackConnector } from '../connectors/slack.mjs';

test('defaults are safe and resolve local paths', () => {
  const c = defaults('/tmp/superagent');
  assert.equal(c.mode, 'observe');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.slack.enabled, false);
  assert.deepEqual(c.gerrit, []);
  assert.equal(validateConfig(c), c);
});
test('GitHub configuration rejects limits and workflow selectors its connector cannot use', async () => {
  const c=defaults('/tmp/superagent');
  const github={id:'gh',baseUrl:'https://api.github.com',tokenEnv:'GITHUB_TOKEN',
    repositories:[{owner:'example',repo:'project',workflows:['build.yml','check.yaml',77,'123']}],maxPages:20,timeoutMs:100};
  const withGithub = value => ({...c,github:[value]});
  const connector = value => pollGithub({...value,token:'fixture'},{fetch:async()=>Response.json({total_count:0,workflow_runs:[]})});
  assert.doesNotThrow(()=>validateConfig(withGithub(github)));
  assert.equal((await connector(github)).healthy,true);
  for (const value of [{...github,maxPages:21},{...github,timeoutMs:99}]) {
    assert.throws(()=>validateConfig(withGithub(value)));
    await assert.rejects(connector(value),/connector limit/);
  }
  for (const workflows of [[''],['nested/build.yml'],['build.txt'],[0],[-1],[1.5],[Number.MAX_SAFE_INTEGER+1],Array(51).fill('build.yml')]) {
    const value={...github,repositories:[{...github.repositories[0],workflows}]};
    assert.throws(()=>validateConfig(withGithub(value)));
    await assert.rejects(connector(value),/allowlist/);
  }
});
test('Jenkins job paths accepted by configuration are usable by the connector', async () => {
  const c=defaults('/tmp/superagent');
  const jenkins={id:'ci',baseUrl:'https://ci.example.test',usernameEnv:'CI_USER',tokenEnv:'CI_TOKEN',jobs:['team/build service'],timeoutMs:100};
  const fetch=async url=>Response.json(String(url).includes('/queue/')?{items:[]}:{builds:[]});
  const connector = value => pollJenkins({...value,username:'reader',token:'fixture'},{fetch});
  assert.doesNotThrow(()=>validateConfig({...c,jenkins:[jenkins]}));
  assert.equal((await connector(jenkins)).healthy,true);
  for (const job of ['team//build','team/../build','team/build\nname','team/\\build','x'.repeat(256)]) {
    const value={...jenkins,jobs:[job]};
    assert.throws(()=>validateConfig({...c,jenkins:[value]}));
    await assert.rejects(connector(value),/job allowlist/);
  }
  const tooShort={...jenkins,timeoutMs:99};
  assert.throws(()=>validateConfig({...c,jenkins:[tooShort]}));
  await assert.rejects(connector(tooShort),/connector limit/);
});
test('enabled Slack identities accepted by configuration are usable by the connector', () => {
  const c=defaults('/tmp/superagent');
  const slack={...c.slack,enabled:true,teamId:'T1',botUserId:'UBOT',channelIds:['C1'],userIds:['U1']};
  const connector = value => new SlackConnector({...value,appToken:'fixture',botToken:'fixture'},{onEvent() {}});
  assert.doesNotThrow(()=>validateConfig({...c,slack}));
  assert.doesNotThrow(()=>connector(slack));
  for (const patch of [{teamId:'T-1'},{botUserId:'u1'},{channelIds:['C1','bad']},{userIds:['U1','U!']}]) {
    const value={...slack,...patch};
    assert.throws(()=>validateConfig({...c,slack:value}));
    assert.throws(()=>connector(value),/Slack allowlist/);
  }
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
