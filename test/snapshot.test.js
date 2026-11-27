import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSnapshot, readSnapshot } from '../src/snapshots/index.js';

test('deduplication, partial failures and page offsets survive independent reads', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'catalog-snapshot-'));
  const previous = process.env.DROGASIL_SNAPSHOT_DB;
  process.env.DROGASIL_SNAPSHOT_DB = path.join(dir, 'run.sqlite');
  t.after(async () => {
    if (previous) process.env.DROGASIL_SNAPSHOT_DB = previous; else delete process.env.DROGASIL_SNAPSHOT_DB;
    await rm(dir, { recursive: true, force: true });
  });
  const sources = { search: async (q, {page}) => ({
    hits: (q === 'empty' ? [] : page ? ['22'] : q === 'first' ? ['11'] : ['11','33']).map(sku => ({ sku })), nbPages: q === 'first' ? 2 : 1 }),
    read: async ({sku}, query) => ({ snapshot: {sku, searchQuery: query} }) };
  const result = await collectSnapshot(['empty','first','first','second'], { maxItems: 3 }, sources);
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(result.records.map(r => [r.sku,r.searchQuery]), [['11','first'],['22','first'],['33','second']]);
  assert.equal((await readSnapshot(result.runId,{ offset:1,limit:1 })).nextOffset,2);
  const partial = await collectSnapshot(['first'],{}, { ...sources, read: async (hit,q) => {
    if (hit.sku === '22') throw new Error('Upstream unavailable');
    return sources.read(hit,q);
  } });
  assert.deepEqual([partial.state,partial.count,partial.error],['failed',1,'Upstream unavailable']);
  await assert.rejects(collectSnapshot([''],{}),TypeError);
});
