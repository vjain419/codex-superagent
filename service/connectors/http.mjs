export function baseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid base URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid base URL');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

export function boundedInt(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid connector limit');
  return value;
}

export function credential(value) {
  if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new Error('Invalid connector credential');
  return value;
}

export async function requestJson(fetchImpl, url, options = {}, timeoutMs = 15000) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('request failed');
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${Number.isInteger(response.status) ? response.status : 'error'}`);
    error.status = response.status;
    const retry = response.headers?.get('retry-after');
    if (retry && /^\d+$/.test(retry)) error.retryAfterMs = Number(retry) * 1000;
    await response.body?.cancel().catch(() => {});
    throw error;
  }
  const maxBytes = 5 * 1024 * 1024;
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large');
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing body');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('response too large'); }
      chunks.push(value);
    }
    return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers };
  } catch {
    throw new Error('invalid or oversized response');
  }
}
