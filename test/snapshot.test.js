import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectSnapshot, readSnapshot } from '../src/snapshots/index.js';
import { catalogSnapshot } from '../src/retailers/catalog.js';

test('simultaneous collections persist every run when the snapshot database is new', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-first-use-'));
  const previous = process.env.DROGASIL_SNAPSHOT_DB;
  t.after(async () => {
    if (previous === undefined) delete process.env.DROGASIL_SNAPSHOT_DB;
    else process.env.DROGASIL_SNAPSHOT_DB = previous;
    await rm(dir, { recursive: true, force: true });
  });
  for (let batch = 0; batch < 4; batch++) {
    process.env.DROGASIL_SNAPSHOT_DB = path.join(dir, batch + '.sqlite');
    const queries = Array.from({length:6}, (_, i) => 'term' + i);
    const source = {
      search: async () => ({hits:[{sku:'123'}], nbPages:1}),
      read: async ({sku}, searchQuery) => ({snapshot:{sku, searchQuery}}),
    };
    const results = await Promise.allSettled(queries.map(query => collectSnapshot([query], {}, source)));
    const ids = new Set();
    for (const [i, result] of results.entries()) {
      assert.equal(result.status, 'fulfilled', result.reason?.message);
      assert.equal(result.value.state, 'succeeded', result.value.error);
      ids.add(result.value.runId);
      const stored = await readSnapshot(result.value.runId);
      assert.deepEqual(stored.records, [{sku:'123', searchQuery:queries[i]}]);
    }
    assert.equal(ids.size, queries.length);
  }
});

test('an omitted query collects the first 20 paracetamol products, explicit empty inputs fail before collection', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-default-'));
  const previous = process.env.DROGASIL_SNAPSHOT_DB;
  process.env.DROGASIL_SNAPSHOT_DB = path.join(dir, 'runs.sqlite');
  t.after(async () => {
    if (previous === undefined) delete process.env.DROGASIL_SNAPSHOT_DB;
    else process.env.DROGASIL_SNAPSHOT_DB = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const searches = [];
  const sources = {
    search: async query => {
      searches.push(query);
      return {hits: Array.from({length:25}, (_, i) => ({sku:String(i + 1)})), nbPages:1};
    },
    read: async ({sku}, searchQuery) => ({snapshot:{sku, searchQuery}}),
  };
  for (const invalid of [null, [], [''], ['  '], ['shampoo', ' ']]) {
    await assert.rejects(collectSnapshot(invalid, {}, sources), TypeError);
  }
  assert.deepEqual(searches, []);
  const implicit = await collectSnapshot(undefined, {}, sources);
  const explicit = await collectSnapshot(['paracetamol'], {}, sources);
  assert.equal(implicit.state, 'succeeded');
  assert.equal(implicit.count, 20);
  assert.deepEqual(implicit.records, explicit.records);
  assert.deepEqual(searches, ['paracetamol', 'paracetamol']);
});

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

test('partner snapshots retain one coherent seller offer in JSON, CSV and XLSX, including older runs', async t => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(path.join(tmpdir(), 'partner-snapshot-'));
  const previous = process.env.DROGASIL_SNAPSHOT_DB;
  process.env.DROGASIL_SNAPSHOT_DB = path.join(dir, 'snapshots.sqlite');
  t.after(async () => {
    if (previous === undefined) delete process.env.DROGASIL_SNAPSHOT_DB;
    else process.env.DROGASIL_SNAPSHOT_DB = previous;
    await rm(dir, {recursive:true, force:true});
  });
  const base = {sku:'17', name:'Shampoo 200 ml', brand:'Exemplo', currency:'BRL', priceScope:'anonymous_online',
    categoryPaths:['/Higiene/', '/Higiene/Cabelos/'], sourceUrl:'https://example.test/search?ft=shampoo',
    productUrl:'https://example.test/shampoo/p', observedAt:'2026-01-01T12:00:00.000Z'};
  const other = {...base, seller:'Loja B', sellerId:'b', currentPrice:5, listPrice:6, onlineStockSignal:12, inStock:true};
  const main = {...base, seller:'Loja A', sellerId:'a', currentPrice:9, listPrice:10, onlineStockSignal:0, inStock:false, isDefaultSeller:true};
  const cli = fileURLToPath(new URL('../bin/drogasil.js', import.meta.url));
  for (const retailer of ['paguemenos','drogariasaopaulo']) {
    const result = await catalogSnapshot({retailer, queries:['shampoo'],maxItems:1},
      {search:async () => [other,main].map(row=>({...row, facts:{Quantidade:['1un']}}))}, {background:false});
    assert.equal(result.state, 'succeeded');
    const [row] = JSON.parse(execFileSync(process.execPath, [cli,'snapshot','export',result.runId,'--format','json']));
    assert.deepEqual(row, result.records[0]);
    assert.deepEqual([row.seller,row.currentPrice,row.listPrice,row.inStock,row.stockSignal,row.discountPercentage],
      ['Loja A',9,10,false,0,null]);
    assert.deepEqual([row.categories,row.categoryPath,row.sourceUrl,row.scrapedAt],
      [['Higiene','Cabelos'],'Higiene > Cabelos',base.sourceUrl,base.observedAt]);
    assert.deepEqual(row.offers.map(o=>o.seller), ['Loja B','Loja A']);
    assert.deepEqual(row.offers.map(o=>o.packageQuantities), [['1un'],['1un']]);
    for (const format of ['csv','xlsx']) {
      const bytes = execFileSync(process.execPath,[cli,'snapshot','export',result.runId,'--format',format]);
      const cells = JSON.parse(execFileSync('python3',['-c', `
import csv,io,json,sys,zipfile,xml.etree.ElementTree as E
if sys.argv[1] == 'csv':
    record = next(csv.DictReader(io.StringIO(sys.stdin.read())))
else:
    with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
        rows = E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//{*}row')
    header = {c.get('r')[:-1]: ''.join(c.itertext()) for c in rows[0]}
    record = {header[c.get('r')[:-1]]: ''.join(c.itertext()) for c in rows[1]}
print(json.dumps([record['seller'],record['currentPrice'],record['stockSignal'],record.get('discountPercentage',''),len(json.loads(record['offers']))]))
`, format], {input:bytes}));
      assert.deepEqual(cells, ['Loja A','9','0','',2]);
    }
  }
  const old = await collectSnapshot(['shampoo'], {maxItems:2}, {
    search: async () => ({hits:[{sku:'17',offers:[other]}, {sku:'18',offers:[other,{...main,isDefaultSeller:false}]}],nbPages:1}),
    read: async (hit, searchQuery) => ({snapshot:{retailerId:'paguemenos', searchQuery, ...hit}}),
  });
  assert.equal(old.records[0].currentPrice, 5);
  assert.equal(old.records[1].currentPrice, null);
  assert.equal(old.records[1].inStock, null);
  assert.equal(old.records[1].offers.length, 2);
});
