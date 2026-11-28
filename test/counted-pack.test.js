import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countedOffers } from '../src/retailers/counted-offers.js';
import { countedPack, directCountedListing } from '../src/api/counted-pack.js';
import { samePack } from '../src/api/retail-prices.js';

test('a short catalog unit label can contradict otherwise identical titles and barcodes', () => {
  const box = {gtin:'4006381333931', name:'Paracetamol 750 mg 20 comprimidos'};
  for (const quantity of ['10un', '10 un.', '10 und', '10 unid.', '10 unidades', '10 cápsulas']) {
    assert.equal(samePack(box, {...box, facts:{Quantidade:[quantity]}}), false, quantity);
  }
  assert.ok(samePack(box, {...box, facts:{Quantidade:['20un']}, productUrl:'https://example.org/caixa-10'}));
});

test('a manufacturer-qualified request keeps only the verified maker and presentation', async () => {
  const row = {sku:'p', sellerId:'1', name:'Paracetamol 750mg 10 comprimidos', manufacturer:'Medquímica',
    activeIngredients:['paracetamol'], facts:{Quantidade:['10un'], Apresentação:['Comprimido'],
      'Formas de Administração':['Via Oral'], 'Tipo de Liberação':['Liberação imediata']}};
  const rows = [row, {...row, sku:'b', manufacturer:'Outro'}, {...row, sku:'c',facts:{Quantidade:['20un']}},
    {...row, sku:'d',facts:{'Tipo de Liberação':['Prolongada']}},
    {...row, sku:'e',facts:{'Formas de Administração':['Sublingual']}}];
  for (const suffix of ['Medquímica 750 mg 10 comprimidos','da Medquímica, 750 mg, caixa de 10 comprimidos',
    '750 mg 10 comprimidos da Medquímica']) {
    const result = await countedOffers('paguemenos', 'paracetamol '+suffix, {search:async()=>rows},
      {kind:'ingredient',name:'paracetamol',suffix}, {});
    assert.deepEqual(result.products.map(p=>p.sku), ['p'], suffix);
  }
});

test('direct named packs require independent strength and ingredient evidence', () => {
  const dose = { description: 'Exemplo', dosageValue: '2,5', unitOfMeasurement: { name: 'MG' } };
  const product = { name: 'A 2,5 mg 20 comprimidos', details: { activeIngredients: [dose], quantidade: '20 comprimidos' } };
  const requested = countedPack('2,5 mg caixa com 20 comprimidos');
  const matches = p => directCountedListing(p, 'Exemplo', requested);
  assert.ok(matches(product));
  for (const form of ['Em Comprimido', 'Em comprimidos revestidos']) {
    assert.ok(matches({...product, filters:{'Forma farmacêutica':form}}), form);
  }
  for (const form of ['Em cápsula', 'Em comprimido sublingual']) {
    assert.equal(matches({...product, filters:{'Forma farmacêutica':form}}), false, form);
  }
  for (const route of ['Uso oral', 'Via oral', 'Oral']) {
    assert.ok(matches({...product, filters:{'Via de administração':route}}), route);
  }
  for (const route of ['Uso sublingual','Tópico e oral','Uso oral ou vaginal']) {
    assert.equal(matches({...product, filters:{'Via de administração':route}}), false, route);
  }
  assert.equal(countedPack('2,5 mg'), null);
  assert.equal(countedPack('2 mg/mL 20 mL'), null);
  for (const name of ['A 2,5 mg 10 comprimidos', 'A 2,5 mg 20 cápsulas', 'A XR 2,5 mg 20 comprimidos',
    'A 2,5 mg 20 comprimidos sublinguais', 'A 2,5 mg 20 comprimidos efervescentes',
    'Kit A 2,5 mg 20 comprimidos', 'A 2,5 mg 2 x 20 comprimidos', 'A 2,5 mg + B 20 comprimidos']) {
    assert.equal(matches({ ...product, name }), false, name);
  }
  for (const extra of [{ quantidade: '10 comprimidos' }, { activeNumberIngredient: 2 },
    { activeIngredients: [dose, dose] }, { activeIngredients: [{ ...dose, description:'Outro' }] },
    { activeIngredients: [{ ...dose, dosageValue: 25 }] }]) {
    assert.equal(matches({ ...product, details: { ...product.details, ...extra } }), false);
  }
  assert.equal(matches({ ...product, filters: { 'Via de administração':'vaginal' } }), false);
});


test('partner listings exclude conflicting composition and use barcodes only for missing ingredients', async () => {
  const name='Analgésico 2,5 mg 20 comprimidos';
  const row={sku:'1', name, sellerId:'retailer', currentPrice:7, facts:{'Princípio Ativo':['Com Exemplo']}};
  const other={...row,sku:'2',currentPrice:3,activeIngredients:['Exemplo'],facts:{'Princípio Ativo':['Com Exemplo','Com Cafeína']}};
  const unknown={...row,sku:'3',facts:{},gtin:'4006381333931'};
  const extras=[{...row,sku:'4',name:name+' XR'}, {...row,sku:'5',facts:{Dosagem:['20MG']},gtin:unknown.gtin}];
  const reference={byGtin:async gtin=>[{name,eanCode:gtin,details:{activeIngredients:[
    {description:'Exemplo',dosageValue:2.5,unitOfMeasurement:{name:'MG'}}]}}]};
  const identity={kind:'ingredient',name:'Exemplo',suffix:'2,5 mg 20 comprimidos'};
  for (const retailer of ['paguemenos','drogariasaopaulo']) {
    const offers=await countedOffers(retailer,identity.suffix,{search:async()=>[row,other,unknown,...extras]},identity,reference);
    assert.equal(offers.catalogComplete,true);
    assert.deepEqual(offers.products.map(p=>[p.sku,p.matchBasis]),[['1','retailer_ingredient_and_pack'],['3','reference_barcode_and_retailer_pack']]);
    assert.deepEqual(offers.unverified.map(p=>p.sku),['4','5']);
  }
  const incomplete=await countedOffers('paguemenos',identity.suffix,{search:async()=>[unknown]},identity,{byGtin:async()=>{ throw Error('offline'); }});
  assert.equal(incomplete.status,'incomplete_presentation');
  assert.deepEqual(incomplete.products,[]);
});
