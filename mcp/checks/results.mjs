import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { compareProducts } from 'drogasil-cli';
import { createServer } from '../tools.js';

test('MCP preserves library ordering and distinguishes outages from empty stock', async t => {
  process.env.DROGASIL_MIN_INTERVAL_MS = '0';
  const base = { sku: '11', name: 'Example tablet', price: 10,
    filters: { 'Forma farmacêutica': 'Comprimido' }, details: { quantidade: '30 comprimidos',
      activeIngredients: [{ description: 'Example', dosageValue: 1, unitOfMeasurement: { name: 'mg' } }] } };
  let stockMode = 'available';
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { requests, variables } = JSON.parse(body);
    if (requests?.[0].objectID) return Response.json({ results: [base] });
    if (requests) return Response.json({ results: [{ hits: [{ ...base, sku: '22', price: 5 }] }] });
    if (stockMode === 'outage') throw new Error('offline');
    if (stockMode === 'empty') return Response.json({ errors: [{ message: 'Filial próxima sem estoque' }] });
    return Response.json({ data: { getNearbyStockByZipCode: [
      { branch: { id: 1, businessName: 'Example' }, stocks: [{ sku: variables.p[0].sku, quantity: 2 }] },
    ] } });
  });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'checks', version: '1' });
  const server = createServer();
  await server.connect(remote);
  await client.connect(local);
  t.after(() => client.close());
  const origin = { zipcode: '01001-000' };
  const call = () => client.callTool({ name: 'compare_products', arguments: { query: '11', origin } });
  const result = await call();
  const direct = await compareProducts('11', { origin });
  assert.deepEqual(result.structuredContent.products.map(p => p.sku), direct.products.map(p => p.sku));
  assert.deepEqual(result.structuredContent.products.map(p => p.sku), ['22', '11']);
  stockMode = 'empty';
  assert.equal((await call()).structuredContent.status, 'no_stock');
  stockMode = 'outage';
  assert.equal((await call()).isError, true);
});

test('incomplete catalog hits return exact stock at the same branch without a SKU retry', async t => {
  process.env.DROGASIL_MIN_INTERVAL_MS = '0';
  const product = { sku: '11', name: 'Example 10mg 12 comprimidos', price: 12,
    details: { quantidade: '12 Comprimidos', activeIngredients: [
      { description: 'Example', dosageValue: 10, unitOfMeasurement: { name: 'MG' } },
    ] } };
  const other = { ...product, sku: '22', price: 5 };
  const hits = [product, other];
  const nearest = { branch: { id: 1, businessName: 'Near' }, stocks: [] };
  const farther = { branch: { id: 2, businessName: 'Far' }, stocks: [] };
  const requestsForStock = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { requests, variables } = JSON.parse(body);
    if (requests?.[0].objectID) return Response.json({ results: [product] });
    if (requests?.[0].facets) return Response.json({ results: [{ facets: {
      'details.activeIngredients.description': { Example: 2 }, 'filters.Marca': {} } }] });
    if (requests) return Response.json({ results: [{ hits, nbHits: hits.length, nbPages: 1 }] });
    const [item] = variables.p;
    assert.equal(item.quantity, undefined);
    requestsForStock.push(item.sku);
    const near = { ...nearest, stocks: [{ sku: item.sku, quantity: item.sku === '11' ? null : 0 }] };
    const far = { ...farther, stocks: [{ sku: item.sku, quantity: 7 }] };
    const rows = item.sku === '11' && requestsForStock.length === 2 ? [far, near] : [near, far];
    return Response.json({ data: { [variables.lat ? 'getNearbyStockByLatLong' : 'getNearbyStockByZipCode']: rows } });
  });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'regression', version: '1' });
  await createServer().connect(remote);
  await client.connect(local);
  t.after(() => client.close());
  const origin = { zipcode: '01001-000' };
  const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
  const conflict = await call('compare_products', { query: 'Example XR 10mg de liberação imediata', origin, store: 'nearest' });
  assert.equal(conflict.status, 'conflicting_release');
  assert.deepEqual(requestsForStock, []);
  const result = await call('compare_products', { query: 'Example 10mg, caixa de 12 comprimidos', origin, store: 'nearest' });
  assert.equal(result.status, 'incomplete_presentation');
  assert.deepEqual(result.missingFields, ['dosage_form']);
  assert.deepEqual(result.products.map(p => [p.sku, p.storeId, p.stockStatus]), [
    ['22', '1', 'out_of_stock'], ['11', '1', 'unknown'] ]);
  assert.deepEqual(requestsForStock, ['22', '11']);
  const exact = await call('compare_products', { query: '11', origin, store: 'nearest' });
  assert.equal(exact.status, 'incomplete_presentation');
  assert.deepEqual(exact.products.map(p => p.sku), ['11']);
  const nearby = await call('find_nearby_stock', { sku: '22', origin, minimumQuantity: 3 });
  assert.equal(nearby.nearestStore.id, 1);
  assert.equal(nearby.nearestStore.quantity, 0);
  assert.deepEqual(nearby.stores.map(s => s.id), [2]);
  const closest = await call('find_nearby_stock', { sku: '11', origin: { latitude: -8, longitude: -35 }, store: 'nearest' });
  assert.deepEqual(closest.stores.map(s => [s.id, s.quantity]), [[1, null]]);
  hits.push({ ...product, sku: '33', name: 'Example 10mg 30 comprimidos', details: { ...product.details, quantidade: '30 Comprimidos' } });
  const ambiguous = await call('compare_products', { query: 'Example 10mg', origin, store: 'nearest' });
  assert.equal(ambiguous.status, 'ambiguous');
});

test('one purchase tool call returns both tables and a merged trip, including catalog type', async t => {
  process.env.DROGASIL_MIN_INTERVAL_MS = '0';
  const skus = [];
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const { requests, variables } = JSON.parse(body);
    if (requests) {
      const sku = requests[0].objectID;
      return Response.json({ results: [{ sku, name: 'Example Genérico ' + sku, price: 5, details: {} }] });
    }
    skus.push(variables.p[0].sku);
    return Response.json({ data: { getNearbyStockByZipCode: [{ branch: {
      id: 9, businessName: 'Central', distanceKMFromSearch: 1 }, stocks: [{ sku: variables.p[0].sku, quantity: 2 }] }] } });
  });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'plan-check', version: '1' });
  await createServer().connect(remote);
  await client.connect(local);
  t.after(() => client.close());
  const result = await client.callTool({ name: 'plan_purchase', arguments: {
    items: [{ query: '11' }, { query: '22', quantity: 2 }], origin: { zipcode: '00000-000' },
  } });
  const data = result.structuredContent;
  assert.deepEqual(skus.sort(), ['11', '22']);
  assert.equal(data.status, 'complete');
  assert.deepEqual(data.tables.map(t => [t.rows[0].option, t.rows[0].type]), [['A1', 'Genérico'], ['B1', 'Genérico']]);
  assert.deepEqual(data.plans.map(p => [p.objective, p.roundTripKm, p.totalBRL]), [['both', 2, 15]]);
});

test('one information call answers several products with no pricing or stock request', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, { body }) => {
    assert.match(url, /objects$/);
    const [r] = JSON.parse(body).requests;
    assert.ok(!r.attributesToRetrieve.includes('price'));
    calls.push(r.objectID);
    return Response.json({ results: [{ sku: r.objectID, name: 'Exemplo', details: {} }] });
  });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'facts-check', version: '1' });
  await createServer().connect(remote);
  await client.connect(local);
  t.after(() => client.close());
  const result = await client.callTool({ name: 'get_medication_info', arguments: { queries: ['111', '222'] } });
  assert.deepEqual(result.structuredContent.results.map(r => r.query), ['111', '222']);
  assert.deepEqual(calls, ['111', '222']);
});
