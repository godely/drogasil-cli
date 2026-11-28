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
