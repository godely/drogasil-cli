import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medicationType, planPurchase } from '../src/api/index.js';
import { applySelections, renderPurchase } from '../src/commands/plan.js';
import { optimizePlans } from '../src/api/purchase-plans.js';

const origin = { zipcode: '00000-000' };
function product(sku, name, price, ingredient = 'Example') {
  return { sku, name, price, brand: name.split(' ')[0], filters: { 'Forma farmacêutica': 'Comprimido' },
    details: { quantidade: '10 comprimidos', dosageList: ['1MG'], activeIngredients: [
      { description: ingredient, dosageValue: 1, unitOfMeasurement: { name: 'mg' } }] } };
}

function fixture(t) {
  process.env.DROGASIL_MIN_INTERVAL_MS = '0';
  const a = product('11', 'Alpha 1mg 10 comprimidos', 10);
  const generic = product('12', 'Example Genérico 1mg 10 comprimidos', 3);
  const b = product('21', 'Beta 1mg 10 comprimidos', 5, 'BetaIngredient');
  const products = [a, generic, b];
  // A's cheapest variant is in branch 1. B's nearest is 2. Only 3 has both.
  const inventory = { 11: [0, 0, 5], 12: [2, 0, 0], 21: [0, 3, 2] };
  const ids = [1, 2, 3], distances = [1, 2, 3];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const { requests, variables, query } = JSON.parse(init.body);
    const req = requests?.[0];
    if (req?.facets) return Response.json({ results: [{ facets: {
      'filters.Marca': { Alpha: 1, Beta: 1 }, 'details.activeIngredients.description': { Example: 2, BetaIngredient: 1 } } }] });
    if (req?.objectID) return Response.json({ results: [products.find(p => p.sku === req.objectID) ?? null] });
    if (req) {
      const hits = /filters.Marca:"Alpha"/.test(req.filters) ? [a] :
        /filters.Marca:"Beta"/.test(req.filters) ? [b] :
        /"Example"/.test(req.filters) ? [a, generic] : [b];
      return Response.json({ results: [{ hits, nbHits: hits.length, nbPages: 1 }] });
    }
    if (query.includes('stores(input:')) return Response.json({ data: { stores: { items: ids.map(id =>
      ({ id, address: { latitude: 0, longitude: id / 100 } })) } } });
    const { sku, quantity } = variables.p[0];
    assert.equal(quantity, undefined);
    calls.push(sku);
    if (inventory[sku] === 'failed') throw Error('upstream offline');
    const rows = ids.map((id, i) => ({ branch: { id, businessName: 'Loja ' + id, distanceKMFromSearch: distances[i] },
      stocks: [{ sku, quantity: inventory[sku][i] }] }));
    return Response.json({ data: { getNearbyStockByZipCode: rows } });
  });
  return { inventory, products, calls };
}

test('two compact tables retain farther branches for the one-stop plan and quantify savings', async t => {
  fixture(t);
  const d = await planPurchase(['Alpha 1mg', 'Beta 1mg'], { origin });
  assert.equal(d.status, 'complete');
  assert.deepEqual(d.tables.map(t => t.rows.map(p => [p.option, p.sku, p.store.id])),
    [[['A1', '12', '1'], ['A2', '11', '3']], [['B1', '21', '2']]]);
  assert.deepEqual(d.plans.map(p => [p.objective, p.stops.map(s => s.id).sort(), p.totalBRL]),
    [['fewest_stores', ['3'], 15], ['lowest_price', ['1', '2'], 8]]);
  assert.equal(d.plans[0].roundTripKm, 6);
  assert.ok(Math.abs(d.plans[1].roundTripKm - 4.11195) < 0.0001);
  assert.equal(d.tradeoff.savingsBRL, 7);
  assert.equal(d.tradeoff.extraStops, 1);
  assert.ok(d.tradeoff.extraKm < 0);
  assert.match(renderPurchase(d), /Qtd. em estoque/);
});

test('choices bind to SKUs before refresh, preserve restrictions and identify a lost selection', async t => {
  const { inventory, products } = fixture(t);
  const items = [{ query: 'Alpha 1mg' }, { query: 'Beta 1mg' }];
  const initial = await planPurchase(items, { origin });
  const selected = applySelections(items, initial.tables, 'A2, B1');
  products[0].price = 1;
  const refreshed = await planPurchase(selected, { origin });
  assert.deepEqual(refreshed.tables[0].rows.map(p => p.sku), ['11']);
  assert.equal(refreshed.plans[0].objective, 'both');
  assert.equal(refreshed.plans[0].label, 'Menos lojas e menor preço estimado');
  assert.equal(refreshed.plans[0].stopCount, 1);
  inventory[11] = [0, 0, 0];
  const missing = await planPurchase(selected, { origin });
  assert.equal(missing.status, 'partial');
  assert.equal(missing.tables[0].unavailable[0].sku, '11');
  assert.deepEqual(missing.plans[0].unfilled, ['A']);
  const generic = await planPurchase([{ query: 'Alpha 1mg', genericOnly: true }], { origin });
  assert.equal(generic.tables[0].rows[0].sku, '12');
  const brand = await planPurchase([{ query: 'Alpha 1mg', brand: 'Alpha' }], { origin });
  assert.equal(brand.tables[0].unavailable[0].sku, '11');
});

test('repeated SKU shares the stock snapshot and cannot be over-allocated', async t => {
  const { calls } = fixture(t);
  const result = await planPurchase([{ query: '12', quantity: 2 }, '12'], { origin });
  assert.deepEqual(calls, ['12']);
  assert.equal(result.status, 'partial');
  assert.equal(result.plans[0].unfilled.length, 1);
  assert.ok(result.plans[0].stops[0].pickups.reduce((n, p) => n + p.packs, 0) <= 2);
});

test('a literal generic SKU with an explicit preference reaches branch stock even with incomplete catalog fields', async t => {
  const {products,calls}=fixture(t);
  delete products[1].filters;
  const result=await planPurchase([{query:'12',selectedSku:'12',includeGenerics:false}],{origin});
  assert.deepEqual(calls,['12']);
  assert.deepEqual(result.tables[0].rows.map(p=>p.sku),['12']);
});

test('fixed store keeps reported zero; unknown prices, unknown quantities and outages stay distinct', async t => {
  const { inventory, products } = fixture(t);
  const fixed = await planPurchase(['Alpha 1mg', 'Beta 1mg'], { origin, store: 'nearest' });
  assert.equal(fixed.fixedBranchId, '1');
  assert.equal(fixed.tables[1].rows[0].store.quantity, 0);
  inventory[11] = [null, 0, null];
  inventory[21] = 'failed';
  products[1].price = null;
  const result = await planPurchase(['Alpha 1mg', 'Beta 1mg'], { origin });
  assert.equal(result.tables[0].unknown[0].sku, '11');
  assert.equal(result.tables[0].rows[0].referencePriceBRL, null);
  assert.equal(result.tables[1].failed[0].sku, '21');
  assert.equal(result.plans[0].totalBRL, null);
  assert.equal(result.plans[0].objective, 'fewest_stores');
  assert.equal(result.stockIncomplete, true);
});

test('catalog type needs explicit evidence; incomplete candidates require selection', async t => {
  const { products } = fixture(t);
  assert.equal(medicationType(products[0]), 'Não informado');
  assert.equal(medicationType(products[1]), 'Genérico');
  assert.equal(medicationType({ filters: { 'Medicamentos genéricos': 'Genéricos' } }), 'Genérico');
  assert.equal(medicationType({ details: { tipo_de_medicamento: 'Similar' } }), 'Similar');
  for (const p of products.slice(0, 2)) p.filters = {};
  const result = await planPurchase(['Example 1mg', 'Beta 1mg'], { origin });
  assert.equal(result.tables[0].needsSelection, true);
  assert.equal(result.tables[0].rows.length, 2);
  assert.deepEqual(result.plans[0].unfilled, ['A']);
});

test('common branch can be absent from every displayed nearest-stock row', () => {
  const lines = ['A', 'B'].map((label, i) => ({ label, quantity: 1, choices: [i + 1, 3].map(id => ({
    table: label, sku: label, option: label + '1', packs: 1, cost: 100, unitPriceBRL: 1,
    store: { id: String(id), distanceKm: id, quantity: 1 } })) }));
  const d = optimizePlans(lines, new Map(['1', '2', '3'].map(id => [id, { latitude: 0, longitude: Number(id) / 100 }])));
  assert.equal(d.plans.length, 1);
  assert.equal(d.plans[0].objective, 'both');
  assert.equal(d.plans[0].stops[0].id, '3');
});

test('brand consent precedes stock, restricts both plans and pins the requested brand', async t => {
  const { calls, inventory } = fixture(t);
  const opts = { origin, confirmBrands: true };
  const waiting = await planPurchase(['Alpha 1mg', 'Beta 1mg', 'Example 1mg'], opts);
  assert.equal(waiting.status, 'needs_generic_preference');
  assert.deepEqual(waiting.pendingBrands.map(p => p.label), ['A', 'B']);
  assert.deepEqual(calls, []);
  const items = [{ query: 'Alpha 1mg', brand: 'Alpha', includeGenerics: true },
    { query: 'Beta 1mg', brand: 'Beta', includeGenerics: false }];
  const result = await planPurchase(items, opts);
  assert.deepEqual(result.tables[0].rows.map(p => [p.option, p.sku]), [['A1', '11'], ['A2', '12']]);
  assert.deepEqual(result.plans.map(p => p.totalBRL), [15, 8]);
  assert.match(renderPurchase(result), /Beta.*está disponível/);
  const selected = applySelections(items, result.tables, 'A2, B1');
  assert.equal(selected[0].selectedSku, '12');
  inventory[11] = [0, 0, 0];
  const changed = await planPurchase(items, opts);
  assert.equal(changed.tables[0].rows[0].option, 'A1');
  assert.ok(renderPurchase(changed).indexOf('Sem estoque suficiente') < renderPurchase(changed).indexOf('Farmácia'));
  calls.length = 0;
  const brand = await planPurchase([{ query: 'Alpha 1mg', includeGenerics: false }], opts);
  assert.deepEqual(calls, ['11']);
  assert.equal(brand.status, 'unfilled');
});

test('explicit brand can include a qualifier from the matched commercial presentation', async t => {
  const { products } = fixture(t);
  products[0].name = 'Alpha GTS 1mg 10 comprimidos';
  const result = await planPurchase([{ query: 'Alpha GTS', brand: 'Alpha GTS', includeGenerics: false }], { origin });
  assert.deepEqual(result.tables[0].rows.map(p => p.sku), ['11']);
});

test('a chosen ingredient pack is one shopping line across manufacturers', async t => {
  const { products, inventory, calls } = fixture(t);
  for (const p of products.slice(0, 2)) p.filters = {};
  products[1].details.quantidade = '10 comprimidos revestidos';
  inventory[12] = [0, 0, 0];
  let result = await planPurchase(['Example 1mg 10 comprimidos'], { origin });
  let [table] = result.tables;
  assert.equal(table.matchBasis, 'direct_requested_pack');
  assert.deepEqual(calls.sort(), ['11', '12']);
  assert.deepEqual(table.rows.map(row => row.sku), ['11']);
  assert.equal(table.lowestPricedStockedOption, table.rows[0].option);
  assert.equal(result.coverage.canExpand, false);
  inventory[11] = [0, 0, 0];
  result = await planPurchase(['Example 1mg 10 comprimidos'], { origin });
  assert.equal(result.coverage.canExpand, true);
  assert.equal(result.tables[0].lowestPricedStockedOption, undefined);
  inventory[11] = [null, 0, 0];
  result = await planPurchase(['Example 1mg 10 comprimidos'], { origin });
  assert.equal(result.coverage.canExpand, false);
  assert.equal(result.tables[0].unknown.length, 1);
  inventory[12] = [1, 0, 0];
  const multi = await planPurchase(['Example 1mg 10 comprimidos', 'Beta 1mg'], { origin });
  assert.equal(multi.tables[0].needsSelection, true);
  assert.deepEqual(multi.plans[0].unfilled, ['A']);
});
