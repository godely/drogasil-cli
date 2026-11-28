import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredPresentation } from '../src/retailers/registered-packs.js';
import { retailerComparison } from '../src/retailers/shopping.js';
import { purchaseCatalogNotice } from '../src/commands/plan.js';

const brand = {sku:'original',eanCode:'7898060138114',name:'Sinvasmax Sinvastatina 20mg 30 comprimidos',
  details:{ms:'1053501880069',activeIngredients:[{description:'Sinvastatina',dosageValue:'20',unitOfMeasurement:{name:'mg'}}]}};
const generic = {sku:'local',sellerId:'store',name:'Sinvastatina 20mg Genérico Globo Pharma 30 Comprimidos',
  itemName:'Sinvastatina 20mg Genérico Globo Pharma',gtin:'7899620911031',currentPrice:14,
  facts:{NumeroRegistroMS:'1.0535.0185.006-2',Quantidade:'30un','Tipo de Medicamento':'Genéricos'}};
const request = {retailer:'drogariasaopaulo',query:'Sinvasmax 20 mg 30 comprimidos',includeGenerics:true};

function compare(rows, args = {}, anchor = brand) {
  const reference = {compare:async()=>({status:'matches',requestedBrandName:'Sinvasmax',requestedBrandSkus:['original'],products:[anchor]})};
  return retailerComparison({...request,...args},{search:async(term,page)=>{
    if (term.toLowerCase().startsWith('sinvasmax')) return [];
    return typeof rows === 'function' ? rows(page) : rows;
  }},reference);
}

test('registered retail pack, shorter item title, and independent price comparison',async()=>{
  for (const retailer of ['paguemenos','drogariasaopaulo']) {
    const result=await compare([generic],{retailer});
    assert.equal(result.status,'presentation_comparison');
    assert.deepEqual(result.products,[]);
    assert.equal(result.comparisonOptions[0].name,generic.name);
    assert.equal(result.comparisonOptions[0].retailerId,retailer);
    assert.equal(result.comparisonOptions[0].registeredRecords[0].registration,'1053501850062');
    assert.equal(result.registeredPresentation.registeredRelease,null);
    assert.match(purchaseCatalogNotice(result),/Globo.*14,00/);
  }
});
test('verify duplicate source rows against the declared registration',()=>{
  const code='7897595632548';
  assert.equal(registeredPresentation(code).records.length,2);
  assert.equal(registeredPresentation(code,'1.0068.1124.043-0').records.length,1);
  assert.equal(registeredPresentation(code,9876),null);
});
test('conflicting shop fields, codes, presentations and combinations cannot enter a comparison',async()=>{
  const rows=[
    {name:generic.name.replace('20mg','40mg')},{itemName:'Sinvastatina 30mg Genérico Globo Pharma'},
    {name:generic.name.replace('30 Comprimidos','60 Comprimidos')},{itemName:generic.itemName+' kit'},
    {name:generic.name.replace('Sinvastatina','Atorvastatina'),itemName:null},
    {activeIngredients:['Sinvastatina','Ezetimiba']},{facts:{Quantidade:'60un'}},
    {facts:{Dosagem:'40mg'}},{facts:{NumeroRegistroMS:'0000000000000'}},
    {facts:{'Tipo de Medicamento':'Similar'}},{facts:{Generico:'Não'}},
    {facts:{'Tipo de Liberação':'Liberação retardada'}},{facts:{'Via de Administração':'Sublingual'}},
    {facts:{Kit:true}},{gtin:'7896004701967'}
  ];
  for (const changes of rows) {
    const result=await compare([{...generic,...changes}]);
    assert.deepEqual(result.comparisonOptions,[],JSON.stringify(changes));
  }
  for (const query of ['Sinvasmax 20 mg 60 comprimidos','Sinvasmax XR 20 mg 30 comprimidos','Sinvasmax 20mg em gotas']) {
    assert.equal((await compare([generic],{query})).comparisonOptions?.length ?? 0,0,query);
  }
  for(const detail of [{ms:'9999'},{activeNumberIngredient:2},{activeIngredients:[{description:'Sinvastatina',dosageValue:40}]}]) {
    const result=await compare([generic],{}, {...brand,details:{...brand.details,...detail}});
    assert.equal(result.comparisonStatus,'unverified_reference_presentation');
  }
  const noConsent=await compare([generic],{includeGenerics:false});
  assert.equal(noConsent.comparisonOptions,undefined);
});
test('source failure and partial pagination preserve evidence separately from a complete miss',async()=>{
  assert.equal((await compare(()=>{throw Error('offline')})).status,'source_failed');
  const list=Array.from({length:50},(_,i)=>({...generic,sku:String(i)}));
  const partial=await compare(page=>{if(page===1)return list;throw Error('offline')});
  assert.equal(partial.comparisonStatus,'partial');
  assert.equal(partial.comparisonOptions.length,50);
  assert.deepEqual(partial.products,[]);
});

test('prolonged release requires matching registered packs and explicit retailer evidence',async()=>{
  const anchor={sku:'original',eanCode:'7892953208380',name:'Fenazic 15 mg 30 comprimidos de liberação prolongada'};
  const offer={name:'Bromidrato de Darifenacina 15 mg 30 comprimidos Genérico',sku:'test',gtin:'7892953208465',
    facts:{'Tipo de Liberação':'Liberação prolongada'}};
  const options={...request,query:anchor.name};
  const ref={compare:async()=>({status:'matches',requestedBrandName:'Fenazic',requestedBrandSkus:['original'],products:[anchor]})};
  for(const [facts,expected] of [[offer.facts,1],[{},0],[{'Tipo de Liberação':'Liberação retardada'},0]]) {
    const source={search:async q=>q===anchor.name?[]:[{...offer,facts}]};
    const result=await retailerComparison(options,source,ref);
    assert.equal(result.comparisonOptions.length,expected);
    assert.deepEqual(result.products,[]);
  }
});

test('a listed similar stays first and remains the only product eligible for its own basket', async()=>{
  const listed={...brand,sku:'brand-local',gtin:brand.eanCode,brand:'Fabricante',type:'Similar',currentPrice:27,
    facts:{Apresentação:['Em Comprimido']}};
  const source={
    search:async q=>q.toLowerCase().startsWith('sinvasmax')?[listed]:[generic],
    product:async()=>[listed],
  };
  const ref={byGtin:()=>assert.fail('the registered retailer listing identifies the brand')};
  const compared=await retailerComparison(request,source,ref);
  assert.equal(compared.requestedBrand.status,'listed');
  assert.equal(compared.status,'matches');
  assert.deepEqual(compared.products.map(p=>[p.name,p.role]),[[listed.name,'requested']]);
  assert.deepEqual(compared.comparisonOptions.map(p=>p.name),[generic.name]);
  assert.doesNotMatch(purchaseCatalogNotice(compared),/não encontrou a caixa/);
  const wrong=await retailerComparison({...request,query:'Sinvasmax 20 mg 60 comprimidos'},source,ref);
  assert.equal(wrong.status,'no_match');
  assert.deepEqual(wrong.products,[]);
  const declined=await retailerComparison({...request,includeGenerics:false},source,ref);
  assert.equal(declined.comparisonOptions,undefined);
  const id=await retailerComparison({...request,query:'1234'},source,ref);
  assert.equal(id.requestedBrand.status,'listed');assert.equal(id.comparisonOptions.length,1);
  const failure={...source,search:async q=>{if(q.toLowerCase().startsWith('sinvasmax')) return [listed]; throw Error('offline')}};
  const partial=await retailerComparison(request,failure,ref);
  assert.equal(partial.comparisonStatus,'source_failed');
  assert.equal(partial.products[0].sku,listed.sku);
});
