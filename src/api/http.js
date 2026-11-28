// Shared HTTP layer: User-Agent, timeout, and a small self-imposed rate
// limit. Neither Drogasil API is authenticated, so behave politely.
//
// The User-Agent matters. Akamai in front of the GraphQL endpoint answers 403
// unless the UA *starts with* a recognised HTTP-client token such as
// `curl/<ver>`; a browser-looking UA from a non-browser TLS stack is blocked,
// and so is a bare tool name. The default
// below keeps the curl prefix and then identifies this tool honestly.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/** Package version, read once from package.json so the User-Agent never drifts. */
export const VERSION = pkg.version;

const USER_AGENT = process.env.DROGASIL_USER_AGENT ?? `curl/8.7.1 drogasil-cli/${VERSION}`;

/**
 * Read a numeric environment variable. Resolved lazily (on the first request)
 * so a bad value surfaces as a normal error message instead of crashing module
 * evaluation before the CLI's error handling is installed.
 */
function envNumber(name, fallback, min) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${name} must be a number >= ${min}, got "${raw}"`);
  }
  return n;
}

let settings;
function getSettings() {
  settings ??= {
    minIntervalMs: envNumber('DROGASIL_MIN_INTERVAL_MS', 250, 0),
    timeoutMs: envNumber('DROGASIL_TIMEOUT_MS', 15_000, 1),
  };
  return settings;
}

// Requests queue behind one promise so concurrent callers (the API is also
// importable as a library) are spaced out instead of all firing at once.
let queue = Promise.resolve();
let lastRequestAt = 0;

function throttle() {
  const turn = queue.then(async () => {
    const wait = lastRequestAt + getSettings().minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} url
   * @param {unknown} body parsed JSON when possible, otherwise the raw text
   * @param {string} [message]
   */
  constructor(status, url, body, message = `HTTP ${status} from ${url}`) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** The request never produced a response: DNS, TCP, TLS failure or timeout. */
export class NetworkError extends Error {
  constructor(url, cause, timeoutMs) {
    const reason =
      cause?.name === 'TimeoutError'
        ? `timed out after ${timeoutMs} ms`
        : (cause?.cause?.message ?? cause?.message ?? String(cause));
    super(`request to ${url} failed: ${reason}`, { cause });
    this.name = 'NetworkError';
    this.url = url;
  }
}

/**
 * POST a JSON body and parse a JSON response.
 * Throws NetworkError when no response arrives, HttpError on a non-2xx status
 * or on a 2xx body that is not JSON (an Akamai block page, for example).
 * @param {string} url
 * @param {unknown} body
 * @param {Record<string,string>} [headers]
 * @returns {Promise<any>}
 */
export async function postJson(url, body, headers = {}, onResponseBytes) {
  const { timeoutMs } = getSettings();
  await throttle();

  let res;
  let text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    throw new NetworkError(url, err, timeoutMs);
  }

  onResponseBytes?.(Buffer.byteLength(text));
  let json;
  let parsed = false;
  try {
    if (text) {
      json = JSON.parse(text);
      parsed = true;
    }
  } catch {
    parsed = false;
  }

  if (!res.ok) {
    const error = new HttpError(res.status, url, parsed ? json : text);
    error.retryAfter = res.headers.get('retry-after');
    throw error;
  }
  if (!parsed) {
    throw new HttpError(res.status, url, text, `non-JSON response (HTTP ${res.status}) from ${url}`);
  }
  return json;
}
