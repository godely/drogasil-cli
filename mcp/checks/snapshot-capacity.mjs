import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {collectSnapshot} from '../../src/snapshots/index.js';

const topics = Array.from({length: 10}, (_, i) => 'grupo ' + (i + 1));
const observedAt = '2026-01-01T12:00:00.000Z';
const sku = i => String(i).padStart(7, '0');

function observation(i, query) {
  const available = i % 3 === 0 ? null : i % 3 === 1;
  return {
    sku: sku(i), name: 'Produto ' + i + ', edição "A"', brand: i % 2 ? 'Marca' : null,
    categories: ['Cuidados', 'Higiene'], categoryPath: 'Cuidados > Higiene',
    productUrl: 'https://example.test/item/' + i,
    currentPrice: i % 5 ? i / 100 : null, listPrice: 30, discountPercentage: i % 5 ? 0 : null,
    currency: 'BRL', stockSignal: available === null ? null : Number(available), inStock: available,
    searchQuery: query, sourceUrl: 'https://example.test/search?w=' + encodeURIComponent(query),
    scrapedAt: observedAt,
  };
}

test('1,000 distinct products from ten overlapping searches survive MCP pagination and all CLI exports', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'snapshot-capacity-'));
  const database = join(dir, 'runs.sqlite3');
  const previous = process.env.DROGASIL_SNAPSHOT_DB;
  process.env.DROGASIL_SNAPSHOT_DB = database;
  t.after(async () => {
    if (previous === undefined) delete process.env.DROGASIL_SNAPSHOT_DB;
    else process.env.DROGASIL_SNAPSHOT_DB = previous;
    await rm(dir, {recursive: true, force: true});
  });

  const expected = Array.from({length: 1000}, (_, i) => observation(i, topics[Math.floor(i / 100)]));
  const searches = [];
  let productReads = 0;
  const sources = {
    async search(query, {page}) {
      const first = topics.indexOf(query) * 100;
      assert.ok(first >= 0 && page < 2);
      searches.push([query, page]);
      const start = page === 0 ? first : first + 60;
      const ids = Array.from({length: page === 0 ? 60 : 40}, (_, i) => start + i);
      if (page === 1) ids.unshift(Math.max(0, first - 1));
      if (first === 900 && page === 1) ids.push(1000);
      return {hits: ids.map(i => ({sku: sku(i)})), nbPages: 2};
    },
    async read(hit, query) {
      productReads++;
      return {snapshot: observation(Number(hit.sku), query)};
    },
  };
  await assert.rejects(collectSnapshot(topics, {maxItems: 1001}, sources), TypeError);
  const run = await collectSnapshot(topics, {maxItems: 1000}, sources);
  assert.equal(run.state, 'succeeded', run.error);
  assert.deepEqual(searches, topics.flatMap(query => [[query, 0], [query, 1]]));
  assert.equal(productReads, 1000);
  assert.equal(run.count, 1000);
  assert.equal(run.stats.skippedDuplicates, 10);
  assert.equal(run.stats.rowsScanned, 1010);
  assert.deepEqual(run.records, expected.slice(0, 20));

  const client = new Client({name: 'snapshot-capacity-test', version: '1'});
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../server.js', import.meta.url))],
    env: {DROGASIL_SNAPSHOT_DB: database},
  });
  try {
    await client.connect(transport);
    let offset = 0;
    while (offset < run.count) {
      const args = {runId: run.runId, offset};
      if (offset) args.limit = 100;
      const reply = await client.callTool({name: 'read_catalog_snapshot', arguments: args});
      assert.ok(!reply.isError, reply.content[0]?.text);
      const page = reply.structuredContent;
      assert.equal(page.state, 'succeeded');
      assert.equal(page.offset, offset);
      assert.equal(page.count, 1000);
      const end = Math.min(run.count, offset + (args.limit ?? 20));
      assert.deepEqual(page.records, expected.slice(offset, end));
      assert.equal(page.nextOffset, end < run.count ? end : null);
      offset = end;
    }
    const subset = await client.callTool({name: 'read_catalog_snapshot', arguments: {
      runId: run.runId, offset: 998, limit: 2, fields: ['inStock', 'discountPercentage', 'name', 'sellerId'],
    }});
    assert.ok(!subset.isError, subset.content[0]?.text);
    const projected = subset.structuredContent;
    assert.deepEqual(JSON.parse(subset.content[0].text), projected);
    assert.equal(projected.count, 1000);
    assert.equal(projected.nextOffset, null);
    for (const [i, record] of projected.records.entries()) {
      assert.deepEqual(Object.keys(record), ['inStock', 'discountPercentage', 'name']);
      const {inStock, discountPercentage, name} = expected[998 + i];
      assert.deepEqual(record, {inStock, discountPercentage, name});
    }
    assert.equal(projected.records.length, 2);
  } finally {
    await client.close();
  }

  const cli = fileURLToPath(new URL('../../bin/drogasil.js', import.meta.url));
  for (const format of ['json', 'csv', 'xlsx']) {
    const bytes = execFileSync(process.execPath, [cli, 'snapshot', 'export', run.runId, '--format', format],
      {maxBuffer: 8 * 1024 * 1024});
    if (format === 'json') assert.deepEqual(JSON.parse(bytes), expected);
    await writeFile(join(dir, 'catalog.' + format), bytes);
  }
  const verifySheets = fileURLToPath(new URL('./verify-snapshot-sheets.py', import.meta.url));
  execFileSync('python3', [verifySheets, dir], {stdio: 'pipe'});
});
