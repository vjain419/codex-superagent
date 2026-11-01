import { baseUrl, boundedInt, credential, requestJson } from './http.mjs';

export const validGerritProject = project => typeof project === 'string' && project.length <= 255 &&
  project.split('/').every(part => part.length > 0 && !['.', '..'].includes(part) && /^[a-zA-Z0-9._~+-]+$/.test(part));

export async function pollGerrit(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = baseUrl(config.baseUrl), username = credential(config.username), token = credential(config.token);
  if (username.includes(':')) throw new Error('Invalid connector credential');
  if (!Array.isArray(config.projects) || !config.projects.length || config.projects.length > 50 || !config.projects.every(validGerritProject)) throw new Error('Invalid project allowlist');
  const maxPages = boundedInt(config.maxPages, 3, 1, 20), perPage = boundedInt(config.perPage, 30, 1, 100);
  const timeoutMs = boundedInt(config.timeoutMs, 15000, 100, 60000);
  const headers = { authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`, accept: 'application/json' };
  const result = { events: [], healthy: true, snapshotComplete: true, complete: true, errors: [] };
  for (const project of config.projects) {
    try {
      let complete = false, start = 0;
      for (let page = 0; page < maxPages; page++) {
        const url = new URL('a/changes/', base);
        url.searchParams.set('q', `project:${project}`);
        url.searchParams.set('o', 'ALL_REVISIONS');
        url.searchParams.set('n', String(perPage));
        url.searchParams.set('S', String(start));
        const { body } = await requestJson(fetchImpl, url, { headers }, timeoutMs, { xssi: true });
        if (!Array.isArray(body) || body.length > perPage || body.slice(0, -1).some(change => change._more_changes)) throw new Error('invalid response');
        for (const change of body) {
          if (change.project !== project || !Number.isSafeInteger(change._number) || change._number <= 0 ||
            !['NEW', 'MERGED', 'ABANDONED'].includes(change.status) || typeof change.subject !== 'string' ||
            !change.revisions || typeof change.revisions !== 'object' || Array.isArray(change.revisions) ||
            !change.current_revision || !Object.hasOwn(change.revisions, change.current_revision)) throw new Error('invalid change');
          const numbers = new Set();
          for (const [revision, details] of Object.entries(change.revisions)) {
            if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision) || !Number.isSafeInteger(details?._number) || details._number <= 0 || numbers.has(details._number)) throw new Error('invalid revision');
            numbers.add(details._number);
            const patchset = details._number, number = String(change._number);
            const branch = typeof change.branch === 'string' && change.branch.length <= 255 && !/[\u0000-\u001f\u007f]/.test(change.branch) ? change.branch : null;
            const subject = Array.from(change.subject).slice(0, 300).join('');
            // shortcut: status-only transitions are not events; add separate status observations if lifecycle alerts are required.
            result.events.push({
              id: `gerrit:${JSON.stringify([base.href, project, number, patchset, revision.toLowerCase()])}`,
              source: 'gerrit', kind: 'review', change: number, patchset, project, status: change.status,
              text: `Gerrit ${project} change ${number} patch set ${patchset} (${change.status}): ${subject}`,
              scm: { certainty: 'partial', repository: null, headSha: revision, branch },
            });
          }
        }
        if (!body.at(-1)?._more_changes) { complete = true; break; }
        start += body.length;
      }
      if (!complete) { result.complete = false; result.errors.push('Gerrit change coverage truncated'); }
    } catch (error) {
      result.healthy = false; result.snapshotComplete = false; result.complete = false;
      result.errors.push(`Gerrit change poll failed: ${/^HTTP \d+$/.test(error.message) ? error.message : 'request or response error'}`);
    }
  }
  result.events = [...new Map(result.events.map(event => [event.id, event])).values()];
  return result;
}
