import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, validateConfig, saveConfig, loadConfig, resolveSecrets } from '../config.mjs';

test('defaults are safe and resolve local paths', () => {
  const c = defaults('/tmp/superagent');
  assert.equal(c.mode, 'observe');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.slack.enabled, false);
  assert.equal(validateConfig(c), c);
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
