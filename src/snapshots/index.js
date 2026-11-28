import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { searchProducts } from '../api/algolia.js';
import { readStorefront } from '../api/storefront.js';
import { partnerSnapshotRecord } from '../retailers/snapshot-record.js';

const storeScript = fileURLToPath(new URL('./db.py', import.meta.url));
async function store(input) {
  const child = spawn('python3', [storeScript], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = [], errors = [];
  child.stdout.on('data', d => output.push(d));
  child.stderr.on('data', d => errors.push(d));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(Buffer.concat(errors).toString().trim() || 'SQLite worker failed')));
    child.stdin.on('error', reject);
  });
  child.stdin.end(JSON.stringify(input));
  await done;
  return output.length ? JSON.parse(Buffer.concat(output)) : undefined;
}

export async function readSnapshot(id, { offset = 0, limit = 20 } = {}) {
  if (typeof id !== 'string' || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new TypeError('Invalid run ID, offset or page size');
  }
  const page = await store({ op: 'read', id, offset, limit });
  page.records = page.records.map(record => {
    if (record.retailerId && Array.isArray(record.offers) && !Object.hasOwn(record, 'scrapedAt')) {
      return partnerSnapshotRecord(record);
    }
    return record;
  });
  return page;
}

export async function collectSnapshot(queries, { maxItems = 20, background = false } = {}, sources = {}) {
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 10 ||
      queries.some(q => typeof q !== 'string' || !q.trim() || q.trim().length > 150) ||
      !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 1000) throw new TypeError('Expected 1–10 queries and 1–1000 items');
  const search = sources.search ?? searchProducts, read = sources.read ?? readStorefront;
  const id = randomUUID();
  await store({ op: 'create', id, at: new Date().toISOString(), pid: process.pid });
  async function collect() {
    const seen = new Set();
    const stats = { searchPages: 0, rowsScanned: 0, productRequests: 0, productPageBytes: 0, uniqueProducts: 0 };
    try {
      collection: for (const query of new Set(queries.map(q => q.trim()))) {
        for (let page = 0; page < 30; page++) {
          stats.searchPages++;
          const data = await search(query, { hitsPerPage: 100, page });
          for (const hit of data.hits) {
            stats.rowsScanned++;
            const sku = String(hit.sku);
            if (!/^\d+$/.test(sku) || seen.has(sku) || /^(service|serviço)$/i.test(hit.type ?? '')) continue;
            if (!sources.read) await pause(750);
            stats.productRequests++;
            const { snapshot, html } = await read(hit, query);
            stats.productPageBytes += Buffer.byteLength(html ?? '');
            await store({ op: 'row', id, row: snapshot });
            seen.add(sku);
            stats.uniqueProducts = seen.size;
            if (seen.size >= maxItems) break collection;
          }
          if (page + 1 >= data.nbPages || !data.hits.length) break;
        }
      }
      await store({ op: 'finish', id, stats, state: 'succeeded' });
    } catch (err) {
      await store({ op: 'finish', id, stats, state: 'failed', error: err.message.split('\n')[0].slice(0,300) });
    }
  }
  const pending = collect();
  if (background) {
    pending.catch(err => process.stderr.write('Snapshot storage failed: ' + err.message + '\n'));
    return { runId: id, state: 'running' };
  }
  await pending;
  return readSnapshot(id);
}
