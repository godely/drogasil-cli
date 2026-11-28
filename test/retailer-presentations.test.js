import assert from 'node:assert/strict';
import test from 'node:test';
import { literalBrandPack } from '../src/api/compare.js';
import { brandPacks, withBrandPacks } from '../src/retailers/presentation-search.js';

const gtin = '7894916513005';
const bottle = { name: 'Patz Hemitartarato de Zolpidem 10mg/ml 20ml Solução Gotas', gtin, sku: 'local', sellerId: '1' };
const reference = { name: 'Patz GTS 10mg/ml gotas 20ml', sku: 'reference', eanCode: gtin };
const prose = 'Patz GTS em gotas, frasco de 20 mL';

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
