import assert from 'node:assert/strict';
import test from 'node:test';
import { literalBrandPack } from '../src/api/compare.js';
import { catalogQuery, matchesRequest } from '../src/api/presentation-label.js';
import { samePack } from '../src/api/retail-prices.js';
import { medicationCard } from '../src/retailers/catalog.js';
import { brandPacks, withBrandPacks } from '../src/retailers/presentation-search.js';

const gtin = '7894916513005';
const bottle = { name: 'Patz Hemitartarato de Zolpidem 10mg/ml 20ml Solução Gotas', gtin, sku: 'local', sellerId: '1' };
const reference = { name: 'Patz GTS 10mg/ml gotas 20ml', sku: 'reference', eanCode: gtin };
const prose = 'Patz GTS em gotas, frasco de 20 mL';

test('sublingual matching uses each pack’s own evidence and preserves strength and count', () => {
  const name = 'Rivotril 0,25 mg 30 comprimidos';
  const structured = {name, filters:{'Forma farmacêutica':'Comprimido sublingual','Via de administração':'Uso oral'}};
  const plural = {name:name+' sublinguais'};
  const mixedRoutes = {'Via de Administração':['Sublingual','Via oral']};
  for (const row of [structured, plural]) {
    assert.ok(matchesRequest(row, catalogQuery('Rivotril em comprimidos sublinguais')));
    assert.ok(matchesRequest(row, '0,25 mg 30 comprimidos sublinguais'));
    assert.equal(matchesRequest(row, '2 mg sublingual'), false);
    assert.equal(matchesRequest(row, '60 comprimidos sublinguais'), false);
  }
  assert.equal(literalBrandPack({name, facts:mixedRoutes}, 'Rivotril sublingual', 'Rivotril'), false);
  assert.equal(literalBrandPack({name, facts:{'Via de Administração':['Via sublingual']}}, 'Rivotril sublingual', 'Rivotril'), true);
  assert.deepEqual(medicationCard({...plural,facts:mixedRoutes}).routes,['Sublingual']);
  assert.ok(samePack({...structured,gtin}, {...plural,gtin}));
  assert.equal(samePack({...plural,gtin}, {gtin,name,itemName:name,facts:mixedRoutes}), false);
});

test('a local pack can omit the brand suffix and still corroborate drops and the bottle volume', async () => {
  const source = { search: async () => [bottle], byGtin: async () => [bottle, { ...bottle, sku: 'kit', name: bottle.name + ' + porta-comprimidos' }] };
  const search = withBrandPacks(source, async query => ({ brand: 'Patz', hits: query.includes('30') ? [] : [reference] })).search;
  for (const query of ['Patz GTS', prose]) {
    const rows = await search(query);
    assert.deepEqual(rows.map(row => row.sku), ['local']);
    assert.equal(rows[0].presentationEvidence, 'verified_reference_barcode_and_pack');
  }
  assert.deepEqual(await search(prose.replace('20','30')), []);
  assert.equal(literalBrandPack(bottle, 'Patz GTS 5mg/ml', 'Patz'), false);
});

test('release evidence, pack count and brand constrain the literal retailer fallback', () => {
  const query = 'Frontal 2 mg 30 comprimidos de liberação imediata';
  const name = 'Frontal 2 mg 30 comprimidos';
  assert.equal(literalBrandPack({name},query,'Frontal'), false);
  assert.equal(literalBrandPack({name: name+' Liberação Imediata'},query,'Frontal'), true);
  assert.equal(literalBrandPack({name: name+' XR'},query,'Frontal'), false);
  assert.equal(literalBrandPack({name: name+' XR'},query.replace('imediata','prolongada'),'Frontal'), true);
  assert.equal(literalBrandPack({name: name+' XR'},query.replace('30','60').replace('imediata','prolongada'),'Frontal'), false);
});

test('spelling suggestions still need confirmation, and an unavailable source is an error', async () => {
  const resolve = async () => ({kind:'brand',name:'Frontal'});
  const compare = async () => { throw new Error('outage'); };
  assert.equal(await brandPacks('Frntal 2 mg',{resolve,compare}),null);
  await assert.rejects(brandPacks('Frontal 2 mg',{resolve,compare}),/outage/);
});

test('a retailer that repeats its final full page terminates', async () => {
  let calls = 0;
  const source = {search:async () => { calls++; return Array(50).fill(bottle); }};
  assert.deepEqual(await withBrandPacks(source,async () => ({brand:'Patz',hits:[]})).search('Patz GTS 30ml'),[]);
  assert.equal(calls,2);
});
