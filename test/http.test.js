import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Settings are read on the first request, so these take effect for this file.
process.env.DROGASIL_MIN_INTERVAL_MS = '30';
process.env.DROGASIL_TIMEOUT_MS = '5000';
const { postJson, HttpError, NetworkError, VERSION } = await import('../src/api/http.js');

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const respond = (status, body) => async () => new Response(body, { status });

test('postJson parses JSON and sends the curl-prefixed User-Agent with the package version', async () => {
  let init;
  globalThis.fetch = async (_url, i) => {
    init = i;
    return new Response('{"ok":true}', { status: 200 });
  };
  assert.deepEqual(await postJson('https://x/', { a: 1 }), { ok: true });
  assert.equal(init.headers['user-agent'], `curl/8.7.1 drogasil-cli/${VERSION}`);
  assert.equal(init.body, '{"a":1}');
});

test('a non-JSON 200 body is an error, not an empty result', async () => {
  globalThis.fetch = respond(200, '<html>Access Denied</html>');
  await assert.rejects(
    postJson('https://x/', {}),
    (err) => err instanceof HttpError && err.status === 200 && /non-JSON/.test(err.message),
  );
});

test('HTTP errors carry status and the parsed body', async () => {
  globalThis.fetch = respond(403, '{"error":"blocked"}');
  await assert.rejects(
    postJson('https://x/', {}),
    (err) => err instanceof HttpError && err.status === 403 && err.body.error === 'blocked',
  );
});

test('connection failures and timeouts surface as NetworkError', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
  };
  await assert.rejects(
    postJson('https://x/', {}),
    (err) => err instanceof NetworkError && /ECONNREFUSED/.test(err.message),
  );

  globalThis.fetch = async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  };
  await assert.rejects(
    postJson('https://x/', {}),
    (err) => err instanceof NetworkError && /timed out after 5000 ms/.test(err.message),
  );
});

test('concurrent requests are spaced by the minimum interval', async () => {
  const times = [];
  globalThis.fetch = async () => {
    times.push(Date.now());
    return new Response('{}', { status: 200 });
  };
  await Promise.all([postJson('https://x/', {}), postJson('https://x/', {}), postJson('https://x/', {})]);
  times.sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= 25, `requests ${i - 1} and ${i} were only ${gap} ms apart`);
  }
});
