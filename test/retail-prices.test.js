import test from 'node:test';
import assert from 'node:assert/strict';
import { samePack } from '../src/api/retail-prices.js';

test('exact-pack quotes require a valid shared barcode and consistent presentation evidence', () => {
  const item = name => ({gtin:'7899547543766',name});
  const tablet = item('Exemplo 750 mg 20 comprimidos');
  assert.ok(samePack(tablet,item('Exemplo Genérico 750mg 20 comprimidos revestidos')));
  for (const name of ['Exemplo 750mg 30 comprimidos','Exemplo 500mg 20 comprimidos',
    'Exemplo XR 750mg 20 comprimidos','Exemplo 750mg 20 cápsulas','Exemplo sublingual 750mg 20 comprimidos',
    'Exemplo com 20 comprimidos','Exemplo 750mg 2 x 20 comprimidos']) assert.equal(samePack(tablet,item(name)),false,name);
  assert.equal(samePack(tablet,{...tablet,gtin:'7899547543767'}),false);
  assert.equal(samePack(item('Exemplo 2mg/ml gotas 20ml'),item('Exemplo 2mg/5ml gotas 20ml')),false);
});
