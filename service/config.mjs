import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validGerritProject } from './connectors/gerrit.mjs';

export function defaults(root = resolve('data')) {
  return {
    version: 1, host: '127.0.0.1', port: 3082, adminTokenEnv: 'SUPERAGENT_ADMIN_TOKEN',
    mode: 'observe', pollSeconds: 60, workspaceRoot: resolve(root, 'workspaces'),
    repositoryPath: null, codexHome: resolve(root, 'codex'), codexCommand: 'codex',
    model: 'gpt-6.1-sol', effort: 'high', turnTimeoutMs: 900000, maxConcurrent: 1,
    github: [], jenkins: [], gerrit: [],
    slack: { enabled: false, appTokenEnv: 'SLACK_APP_TOKEN', botTokenEnv: 'SLACK_BOT_TOKEN', teamId: '', botUserId: '', channelIds: [], userIds: [] },
    economics: { currency: 'USD', inputPerMillion: null, cachedInputPerMillion: null, outputPerMillion: null, hourlyRate: null, savedMinutesPerSuccess: null, fixedCost: 0 },
  };
}
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function requireValue(ok, message) { if (!ok) throw new Error(`Invalid configuration: ${message}`); }
function keys(value, allowed, name) {
  requireValue(object(value), `${name} must be an object`);
  requireValue(Object.keys(value).every(k => allowed.includes(k)), `${name} contains unsupported fields`);
}
function envName(v) { return typeof v === 'string' && /^[A-Z][A-Z0-9_]*$/.test(v); }
function strings(v) { return Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0 && s.length < 512); }
function url(v) {
  let u; try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
}
export function validateConfig(c) {
  keys(c, Object.keys(defaults()), 'root');
  requireValue(c.version === 1, 'version must be 1');
  requireValue(['127.0.0.1','::1','0.0.0.0'].includes(c.host), 'unsupported bind address');
  requireValue(Number.isInteger(c.port) && c.port > 0 && c.port < 65536, 'invalid port');
  requireValue(envName(c.adminTokenEnv), 'adminTokenEnv must name an environment variable');
  requireValue(['observe','auto','paused'].includes(c.mode), 'mode must be observe, auto or paused');
  requireValue(Number.isInteger(c.pollSeconds) && c.pollSeconds >= 30 && c.pollSeconds <= 3600, 'pollSeconds must be 30–3600');
  for (const k of ['workspaceRoot','codexHome']) requireValue(typeof c[k] === 'string' && isAbsolute(c[k]), `${k} must be absolute`);
  requireValue(c.repositoryPath === null || typeof c.repositoryPath === 'string' && isAbsolute(c.repositoryPath), 'repositoryPath must be absolute or null');
  requireValue(typeof c.codexCommand === 'string' && c.codexCommand.length > 0 && !/[\r\n\0]/.test(c.codexCommand), 'invalid codexCommand');
  requireValue(typeof c.model === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(c.model), 'invalid model');
  requireValue(['low','medium','high','xhigh','max'].includes(c.effort), 'invalid effort');
  requireValue(c.maxConcurrent === 1, 'this release supports one worker');
  requireValue(Number.isInteger(c.turnTimeoutMs) && c.turnTimeoutMs >= 1000 && c.turnTimeoutMs <= 3600000, 'turn timeout must be 1 second–1 hour');
  const ids=new Set();
  for (const kind of ['github','jenkins','gerrit']) {
    const providers = kind === 'gerrit' && c[kind] === undefined ? [] : c[kind];
    requireValue(Array.isArray(providers) && providers.length <= 50, `${kind} must be a bounded array`);
    for (const p of providers) {
      keys(p, kind === 'github' ? ['id','baseUrl','tokenEnv','repositories','maxPages','perPage','timeoutMs'] : kind === 'jenkins' ? ['id','baseUrl','usernameEnv','tokenEnv','jobs','maxBuilds','timeoutMs'] : ['id','baseUrl','usernameEnv','tokenEnv','projects','maxPages','perPage','timeoutMs'], kind);
      requireValue(typeof p.id === 'string' && /^[\w-]{1,80}$/.test(p.id) && !ids.has(p.id), 'provider IDs must be unique'); ids.add(p.id);
      requireValue(url(p.baseUrl), 'provider baseUrl requires HTTPS without credentials/query/fragment');
      requireValue(envName(p.tokenEnv), 'tokenEnv must name an environment variable');
      if (kind === 'gerrit') {
        requireValue(envName(p.usernameEnv), 'usernameEnv must name an environment variable');
        requireValue(Array.isArray(p.projects) && p.projects.length > 0 && p.projects.length <= 50 && p.projects.every(validGerritProject), 'projects must be explicitly configured');
        if (p.maxPages !== undefined) requireValue(Number.isInteger(p.maxPages) && p.maxPages >= 1 && p.maxPages <= 20, 'invalid maxPages');
        if (p.timeoutMs !== undefined) requireValue(Number.isInteger(p.timeoutMs) && p.timeoutMs >= 100 && p.timeoutMs <= 60000, 'invalid timeoutMs');
      } else if (kind === 'jenkins') {
        requireValue(envName(p.usernameEnv), 'usernameEnv must name an environment variable');
        requireValue(strings(p.jobs) && p.jobs.length > 0 && p.jobs.length <= 50, 'jobs must be explicitly configured');
      } else {
        requireValue(Array.isArray(p.repositories) && p.repositories.length > 0 && p.repositories.length <= 50, 'repositories must be explicitly configured');
        for (const repo of p.repositories) {
          keys(repo,['owner','repo','workflows'],'repository');
          requireValue([repo.owner,repo.repo].every(v => typeof v === 'string' && /^[\w.-]+$/.test(v) && !['.','..'].includes(v)), 'invalid repository name');
          requireValue(repo.workflows === undefined || Array.isArray(repo.workflows) && repo.workflows.every(v => typeof v === 'string' || Number.isInteger(v)), 'invalid workflows');
        }
      }
      for (const k of ['maxPages','perPage','maxBuilds','timeoutMs']) if (p[k] !== undefined) requireValue(Number.isInteger(p[k]) && p[k] > 0 && p[k] <= (k === 'timeoutMs' ? 60000 : 100), `invalid ${k}`);
    }
  }
  keys(c.slack,Object.keys(defaults().slack),'slack');
  requireValue(typeof c.slack.enabled === 'boolean', 'slack.enabled must be boolean');
  requireValue(envName(c.slack.appTokenEnv) && envName(c.slack.botTokenEnv), 'Slack secrets must be environment references');
  requireValue(strings(c.slack.channelIds) && strings(c.slack.userIds), 'Slack allowlists must be arrays');
  requireValue(typeof c.slack.teamId === 'string' && typeof c.slack.botUserId === 'string', 'Slack identities must be strings');
  if (c.slack.enabled) requireValue(c.slack.teamId && c.slack.botUserId && c.slack.channelIds.length && c.slack.userIds.length, 'enabled Slack requires explicit team/bot/channel/user identities');
  keys(c.economics,Object.keys(defaults().economics),'economics');
  requireValue(typeof c.economics.currency === 'string' && /^[A-Z]{3}$/.test(c.economics.currency), 'currency requires three-letter code');
  for(const k of Object.keys(c.economics).filter(k=>k!=='currency')) requireValue(c.economics[k] === null || Number.isFinite(c.economics[k]) && c.economics[k] >= 0, `economics.${k} must be non-negative or null`);
  return c;
}
export function loadConfig(file) { return validateConfig(JSON.parse(readFileSync(file,'utf8'))); }
export function saveConfig(file,c) {
  validateConfig(c); mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${randomUUID()}.tmp`;
  writeFileSync(temp,JSON.stringify(c,null,2)+'\n',{mode:0o600,flag:'wx'}); renameSync(temp,file);
}
export function resolveSecrets(c, env=process.env) {
  const secret=name=>{const value=env[name]; if(!value) throw new Error(`Missing environment variable: ${name}`);return value;};
  const adminToken=secret(c.adminTokenEnv);
  requireValue(adminToken.length >= 32,'admin token must have at least 32 characters');
  return {
    adminToken,
    slack: c.slack.enabled ? {...c.slack,appToken:secret(c.slack.appTokenEnv),botToken:secret(c.slack.botTokenEnv)} : null,
    github:c.github.map(p=>({...p,token:secret(p.tokenEnv)})),
    jenkins:c.jenkins.map(p=>({...p,username:secret(p.usernameEnv),token:secret(p.tokenEnv)})),
    gerrit:(c.gerrit??[]).map(p=>({...p,username:secret(p.usernameEnv),token:secret(p.tokenEnv)})),
  };
}
