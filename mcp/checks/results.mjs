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
