import test from 'node:test';
import assert from 'node:assert/strict';
import { samePack, compareRetailPrices } from 'drogasil-cli';

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

test('a GTIN resolves independently when the Drogasil catalog fails and skips retailers outside the area', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  const row = { gtin: '7899547543766', name: 'Exemplo 750 mg 20 comprimidos', sku: '10' };
  const result = await compareRetailPrices(row.gtin, {
    zipcode: '01001000', includeGenerics: true, retailers: [
      { name: 'Outside', serves: async () => false, byGtin: () => assert.fail('outside the area') },
      { name: 'Available', byGtin: async () => [row], local: async () => ({
        ...row, retailer: 'Available', currentPrice: 7, methods: [
          { channel:'pickup-in-point', service:'Retirada', feeBRL:0, pickupPointId:'1_7', branch:'Centro', address:{city:'São Paulo'} },
          { channel:'delivery', service:'Entrega', feeBRL:8, address:{postalCode:'redacted-delivery-address'} },
        ], priceScope: 'verified_for_cep'
      }) }
    ]
  });
  const [offer] = result.verifiedOffers;
  assert.equal(offer.fulfillmentOptions[0].pickupPointId, '1_7');
  assert.equal(offer.fulfillmentOptions[0].feeBRL, 0);
  assert.equal(offer.fulfillmentOptions[1].address, undefined);
  assert.equal(result.reference.retailer, 'Available');
  assert.deepEqual(result.verifiedOffers.map(offer => offer.sku), ['10']);
  assert.deepEqual(result.checkedRetailers.map(chain => chain.status), ['source_failed','outside_local_directory','verified']);
  assert.equal(result.issues[0].status, 'generic_reference_unavailable');
});
