import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogInfo, medicationCard, retailerBasket } from 'drogasil-cli/retailer-workflows';

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

test('classify oral morphine from the official rule even when a merchant labels it C1',async () => {
  const {medicationCard} = await import('drogasil-cli/retailer-workflows');
  const card = name => medicationCard({name:'Marca em gotas', facts:{
    'Princípio Ativo':name, 'Via de Administração':['Via Oral'], 'Tipo de Receita':['Com Retenção de Receita C1']}});
  const result=card(['Com Sulfato de Morfina Pentaidratado']);
  assert.deepEqual(result.prescriptionLabel,['Com retenção de receita']);
  assert.equal(result.prescription.form,'Notificação de Receita A');
  assert.equal(result.prescription.list,'A1');
  assert.match(result.prescription.rule,/anvisalegis/);
  for(const names of [[],['Normorfina'],['Ópio'],['Morfina','Outra substância']]) {
    const other = card(names);
    assert.equal(other.prescription.form,null);
    assert.equal(other.prescription.retained,true);
    assert.deepEqual(other.prescriptionLabel,['Com retenção de receita']);
  }
});

test('manufacturer provenance stays separate from the product label and seller brand',async () => {
  const {medicationCard} = await import('drogasil-cli/retailer-workflows');
  const row = {name:'Produto de marca',brand:'Marca da rede',productUrl:'https://example.test/loja'};
  assert.equal(medicationCard(row).manufacturer,null);
  assert.equal(medicationCard({...row,facts:{Fabricante:['Produtor']}}).manufacturerSource,row.productUrl);
  const reference = {manufacturer:'Produtor',manufacturerSource:'https://example.test/ficha'};
  assert.equal(medicationCard({...row,...reference}).manufacturerSource,reference.manufacturerSource);
  assert.equal(medicationCard({...row,...reference,facts:{Fabricante:['Outro']}}).manufacturer,null);
});

test('a failed manufacturer cross-check preserves independent local facts as partial',async () => {
  const source = {factsPage:async () => ({rows:[{sku:'1',name:'Produto'}],issues:['manufacturer_lookup_failed']})};
  const result = await catalogInfo({retailer:'partner', queries:['Produto']},source);
  assert.equal(result.results[0].status,'partial');
  assert.equal(result.results[0].products.length,1);
});

test('national evidence and retailer facts survive independent source failures', async () => {
  const {infoExitCode, renderInfoResult} = await import('../src/commands/info-result.js');
  const source = {facts:async query => {
    if (query === 'Primeiro') throw Error('retailer unavailable');
    return [{sku:'10',name:query}];
  }};
  const data = await catalogInfo({retailer:'partner', queries:['Primeiro','Segundo'], scope:'brazil'}, source, async ([term]) => ({
    results:[{brazil:term === 'Primeiro'
      ? {presentations:[{name:'Apresentação nacional',source:'https://example.test/bula'}]}
      : {presentations:[],lookupFailed:true}}]
  }));
  const [first, second] = data.results;
  assert.equal(first.status,'source_failed');
  assert.match(renderInfoResult(first,'Rede'),/Apresentação nacional/);
  assert.equal(second.status,'matches');
  assert.equal(second.nationalStatus,'source_failed');
  assert.equal(infoExitCode([second]),2);
  assert.match(renderInfoResult(second,'Rede'),/Falha ao consultar as apresentações nacionais/);
});

test('explicit prescription evidence independently complements a pharmacy retention field', async () => {
  const {medicationCard} = await import('../src/retailers/catalog.js');
  const label = {source:'retailer_product_overview', required:true, url:'https://example.test/ficha'};
  const card = (raw, evidence) => medicationCard({name:'Medicamento', facts:{'Prescrição Médica':[raw]},prescriptionEvidence:evidence});
  assert.equal(card('Sem Retenção de Receita').prescription.required,null);
  const complete = card('Sem Retenção de Receita',label);
  assert.equal(complete.prescriptionEvidence,label);
  assert.deepEqual(complete.prescription,{required:true,retained:false,form:'Receita simples'});
  assert.equal(card('Venda livre',label).prescription.conflict,true);
  assert.equal(card('',label).prescription.retained,null);
});

test('a published red or black stripe establishes prescription without assuming retention or a form', async () => {
  const {medicationCard} = await import('../src/retailers/catalog.js');
  const {renderInfoResult} = await import('../src/commands/info-result.js');
  const card = (stripe, retention) => medicationCard({name:'Exemplo', productUrl:'https://example.test/pack',
    facts:{'Classificação':stripe,'Prescrição Médica':retention}});
  for (const stripe of ['Tarja Vermelha','Tarja Preta']) {
    const rx = card(stripe).prescription;
    assert.equal(rx.required,true);
    assert.equal(rx.retained,null);
    assert.equal(rx.form,null);
    assert.match(rx.stripeRule,/gov\.br\/anvisa\//);
  }
  const pack = card(['Tarja Vermelha'],'Sem Retenção De Receita');
  assert.deepEqual([pack.prescription.required,pack.prescription.retained],[true,false]);
  assert.ok(renderInfoResult({products:[pack]},'Rede').includes(pack.prescription.stripeRule));
  assert.equal(card('Tarja Vermelha','Venda livre').prescription.conflict,true);
  for (const label of [undefined, 'Sem tarja','Sem tarja vermelha','Tarja desconhecida',['Tarja preta','Sem tarja']])
    assert.equal(card(label,'Sem Retenção De Receita').prescription.required,null);
});

test('pack facts with conflicting manufacturer evidence are kept apart from verified manufacturer matches', async () => {
  const {renderInfoResult,infoExitCode} = await import('../src/commands/info-result.js');
  const claims = [{name:'Empresa A',url:'https://example.test/a'}, {name:'Empresa B',url:'https://example.test/b'}];
  const row = {sku:'5',name:'Exemplo 30 cápsulas',manufacturer:'Empresa A',manufacturerClaims:claims,
    facts:{'Classificação':'Tarja Vermelha','Prescrição Médica':'Sem Retenção de Receita'}};
  const source = {factsPage:async () => ({rows:[],issues:[],unconfirmed:[row]})};
  const {results} = await catalogInfo({retailer:'partner',queries:['Exemplo Empresa A']},source);
  assert.equal(results[0].status,'partial');
  assert.deepEqual(results[0].products,[]);
  const [uncertain] = results[0].unconfirmedProducts;
  assert.equal(uncertain.manufacturer,null);
  assert.equal(uncertain.prescription.required,true);
  assert.equal(uncertain.prescription.retained,false);
  const rendered = renderInfoResult(results[0],'Rede');
  assert.match(rendered,/Fabricante não confirmado.*Empresa A e Empresa B/);
  assert.ok(claims.every(claim => rendered.includes(claim.url)));
  assert.equal(infoExitCode(results),2);
});

test('strength inference keeps recognized denominators and omits unsupported ones', () => {
  const strengths = name => medicationCard({name}).strengths;
  assert.deepEqual(strengths('Exemplo 10 mg/m²'), []);
  assert.deepEqual(strengths('Exemplo 10 mg / g²'), []);
  assert.deepEqual(strengths('Exemplo 10 mg/5 ml'), ['10 mg/5 ml']);
  assert.deepEqual(strengths('Exemplo 10 mg'), ['10 mg']);
});

test('national presentations count as matches when the retailer has no products', async () => {
  const {results} = await catalogInfo({retailer:'partner', queries:['Exemplo'], scope:'brazil'},
    {search: async () => []}, async () => ({results:[{brazil:{presentations:[{name:'Exemplo'}]}}]}));
  assert.equal(results[0].status, 'matches');
  assert.equal(results[0].catalogStatus, 'no_match');
  assert.deepEqual(results[0].products, []);
});

test('basket fulfillment requires one matching quote per requested line', async () => {
  const items = ['12','13'].map(sku => ({sku, sellerId:'1', quantity:2}));
  const quotes = items.map(({quantity, ...offer}) => ({...offer, requestedQuantity:quantity,
    currentPrice:3, localStatus:'available', methods:[{channel:'delivery'}]}));
  const check = (response, requested = items) => retailerBasket({retailer:'partner', items:requested},
    {product:async sku => [{sku, sellerId:'1'}], basket:async () => response});
  for (const response of [[quotes[0]], [quotes[0],quotes[0]], [quotes[0], {...quotes[1], sellerId:'2'}],
    [quotes[0], {...quotes[1], requestedQuantity:1}]]) {
    const result = await check(response);
    assert.equal(result.status, 'partial');
    assert.equal(result.estimatedProductTotalBRL, null);
    assert.equal(result.deliveryForEveryItem, false);
  }
  assert.equal((await check([])).status, 'unconfirmed');
  assert.equal((await check([quotes[0]], [items[0],items[0]])).status, 'partial');
  const complete = await check([...quotes].reverse());
  assert.equal(complete.status, 'fulfillable');
  assert.equal(complete.estimatedProductTotalBRL, 12);
});
