import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogInfo } from 'drogasil-cli/retailer-workflows';

test('national evidence uses the partner SKU title and never imports another catalog listing', async () => {
  const calls = [];
  const source = {product: async sku => sku === '12' ? [{sku, name:'Exemplo 2 mg', productUrl:'https://example.test/12'}] : []};
  const result = await catalogInfo({retailer:'partner', queries:['12','13'], scope:'brazil'}, source, async names => {
    calls.push(names);
    return {results:[{products:[{sku:'foreign'}], brazil:{presentations:[]}}]};
  });
  assert.deepEqual(calls,[['Exemplo 2 mg']]);
  assert.deepEqual(result.results[0].products.map(p => p.sku),['12']);
  assert.deepEqual(result.results[0].brazil,{presentations:[]});
  assert.equal(result.results[1].status,'unknown_sku');
});
