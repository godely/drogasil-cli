import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchStockWindows } from '../src/api/stock-search.js';
import { haversineKm } from '../src/geo.js';

process.env.DROGASIL_MIN_INTERVAL_MS = '0';
const center = { latitude: 0, longitude: 0 };
const minimums = new Map([['7', 2]]);
const store = id => ({ id, storeName: 'Loja ' + id, telephoneAreaCode: '81', telephone: id === 2 ? '33334567' : null,
  address: { latitude: 0, longitude: id === 1 ? 0 : id * 0.01 } });
const row = (id, quantity, sku = '7') => ({ branch: { id, businessName: 'Loja ' + id, distanceKMFromSearch: 0,
  address: { city: 'Teste' } }, stocks: [{ sku, quantity }] });
const response = (field, data) => Response.json({ data: { [field]: data } });

test('only a confirmed zero at every nearby branch for every SKU can offer a wider search', async t => {
  let initial = [row(1, 0)];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { query } = JSON.parse(body);
    calls.push(query);
    return response('getNearbyStockByLatLong', initial);
  });
  const initialResult = await searchStockWindows(minimums, center);
  assert.deepEqual(initialResult.coverage, { checkedStores: 1, radiusKm: 0, allZero: true, stockUnknown: false, canExpand: true });
  assert.equal(initialResult.expandedSearch, undefined);
  assert.equal((await searchStockWindows(minimums, center, { expandSearch: true, allowExpansion: false })).expandedSearch, undefined);
  for (const values of [[1], [0, 2], [0, null], []]) {
    initial = values.map((qty, i) => row(i + 1, qty));
    const r = await searchStockWindows(minimums, center, { expandSearch: true });
    assert.equal(r.coverage.canExpand, false);
    assert.equal(r.expandedSearch, undefined);
  }
  assert.ok(calls.every(q => q.includes('getNearbyStockByLatLong')));
});

test('accepted search ranks up to ten stocked branches from original origin and deduplicates overlapping windows', async t => {
  const stores = [1, 12, 2, 6, 4, 11, 9, 8, 3, 7, 5, 10, 13, 50].map(store);
  const nearby = stores.filter(s => s.id !== 50);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { query, variables } = JSON.parse(body);
    requests.push(query);
    if (query.includes('stores(input')) return response('stores', { items: stores });
    if (variables.z) return response('getNearbyStockByZipCode', [row(1, 0)]);
    assert.equal(variables.p[0].quantity, undefined);
    assert.ok(Number(variables.lon) < 0.25);
    return response('getNearbyStockByLatLong', [...stores].reverse().map(s => row(s.id, s.id === 1 ? 0 : 3)));
  });
  const { coverage, expandedSearch: wide, windows } = await searchStockWindows(minimums, { zipcode: '00000-000' }, { expandSearch: true });
  assert.equal(coverage.canExpand, false);
  assert.equal(wide.partial, false);
  assert.equal(wide.checkedStores, nearby.length);
  assert.equal(wide.totalStockedStores, 12);
  assert.deepEqual(wide.stores.map(s => Number(s.id)), Array.from({ length: 10 }, (_, i) => i + 2));
  assert.equal(wide.stores[0].phone, '(81) 3333-4567');
  assert.equal(wide.stores[1].phone, null);
  assert.ok(Math.abs(wide.stores[0].distanceKm - haversineKm(center, store(2).address)) < 0.01);
  assert.equal(windows.get('7').rows.filter(r => r.branch.id === 1).length, 1);
  assert.equal(windows.get('7').rows.some(r => r.branch.id === 50), false);
  assert.equal(requests.length, 3);
});

test('outage in an accepted search yields partial coverage and retains the local checks', async t => {
  let window = 0;
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { query } = JSON.parse(body);
    if (query.includes('stores(input')) return response('stores', { items: [store(1), store(2)] });
    if (++window === 1) return response('getNearbyStockByLatLong', [row(1, 0)]);
    throw new Error('offline');
  });
  const r = await searchStockWindows(minimums, center, { expandSearch: true });
  assert.equal(r.expandedSearch.partial, true);
  assert.equal(r.expandedSearch.checkedStores, 1);
  assert.deepEqual(r.expandedSearch.stores, []);
  assert.equal(r.coverage.canExpand, false);
});
