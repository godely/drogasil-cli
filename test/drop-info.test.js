import test from 'node:test';
import assert from 'node:assert/strict';
import { getMedicationInfo } from '../src/api/medication-info.js';
import { catalogInfo, medicationCard } from '../src/retailers/catalog.js';

const gtin = '7896676405651';
const reference = {sku:'11', brand:'Marca', eanCode:gtin, url:'marca-solucao.html',
  name:'Marca 10 mg/mL solução oral 60 mL', productDescription:'Marca solução gotas de uso oral.',
  details:{quantidade:'60 mL',activeIngredients:[{description:'Exemplo',dosageValue:10,unitOfMeasurement:{name:'MG'}}]},
  filters:{'Forma farmacêutica':'Solução','Via de administração':'Uso oral'}};
const selected = {sku:'22', gtin, name:'Marca 10 mg solução 60 mL',facts:{'Via de Administração':['Oral']},
  productUrl:'https://example.test/marca'};

test('an information request retrieves the documented form without price, local stock or a commercial offer',async t => {
  t.mock.method(globalThis, 'fetch', async (url, {body}) => {
    assert.match(url,/\/queries\?/);
    const [request] = JSON.parse(body).requests;
    if (request.facets) return Response.json({results:[{facets:{'filters.Marca':{Marca:1,Outra:1}}}]});
    assert.ok(request.attributesToRetrieve.includes('productDescription'));
    assert.ok(!request.attributesToRetrieve.some(field => /price|stock/i.test(field)));
    assert.match(request.filters,/filters.Marca/);
    const other = {...reference,sku:'15',brand:'Outra',name:'Outra 10 mg solução oral 20 mL',
      description:'Outra 10mg/mL',productDescription:'Administrar por via oral. Dissolver as gotas.',
      details:{...reference.details,quantidade:'20 mL'}};
    const hits = request.filters.includes('"Outra"') ? [other] : [reference,
      {...reference,sku:'12',name:'Marca 10 mg comprimidos',productDescription:'',filters:{}},
      {...reference,sku:'13',name:'Marca 10 mg/mL solução injetável 60 mL',filters:{}},
      {...reference,sku:'14',isActive:false}];
    return Response.json({results:[{hits,nbPages:1}]});
  });
  const {results} = await getMedicationInfo(['Marca em gotas','Marca em gotas, frasco de 30 mL',
    'Marca gotas 20 mg/mL','Marca gotas nasal','Outra gotas 10 mg/mL']);
  assert.deepEqual(results.map(r => r.products.map(p => p.sku)),[['11'],[],[],[],['15']]);
  assert.equal(results[0].products[0].form,'Solução em gotas');
  assert.equal(results[4].products[0].ingredients[0].strength,'10 mg/mL');
});

test('partner facts corroborate a local bottle, reject conflicting packs and preserve source failures', async () => {
  const call = (source,records = async () => ({hits:[reference]})) => catalogInfo(
    {retailer:'partner',queries:['Marca em gotas']},source,undefined,records).then(r => r.results[0]);
  const source = {facts:async () => [], factsByGtin:async code => {assert.equal(code,gtin);return [selected];},
    product:assert.fail,search:assert.fail,byGtin:assert.fail,local:assert.fail,basket:assert.fail};
  const [card] = (await call(source)).products;
  assert.deepEqual([card.sku,card.source,card.strengths],['22',selected.productUrl,['10 mg/mL']]);
  assert.match(card.presentationSource,/marca-solucao/);
  for(const change of [{gtin:'7891058002602'},{name:'Marca 10 mg solução 30 mL'},
    {name:'Marca 20 mg solução 60 mL'},{name:'Marca 10 mg/mL solução injetável 60 mL'},
    {facts:{'Via de Administração':['Nasal']}},{facts:{Dosagem:['10 mg/5 mL']}}]) {
    assert.equal((await call({...source,factsByGtin:async () => [{...selected,...change}]})).status,'no_match');
  }
  const down = async () => {throw Error('offline');};
  assert.equal((await call({...source,factsByGtin:down})).status,'source_failed');
  const local = {...selected,name:'Marca 10 mg gotas 60 mL'};
  const partial = await call({...source,facts:async () => [local]},down);
  assert.equal(partial.status,'partial');
  assert.deepEqual(partial.products[0].strengths,[]);
  assert.deepEqual(medicationCard({name:'Marca 10 mg comprimidos'}).strengths,['10 mg']);
});
