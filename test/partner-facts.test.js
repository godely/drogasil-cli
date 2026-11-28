import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogInfo, medicationCard } from 'drogasil-cli/retailer-workflows';

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

test('derives prescription and retention independently from retailer evidence', () => {
  const facts = fields => medicationCard({sku:'12',name:'Exemplo',facts:fields}).prescription;
  assert.deepEqual(facts({'Prescrição Médica':['Sem Retenção de Receita']}),{required:null,retained:false,form:null});
  assert.deepEqual(facts({'Prescrição Médica':['Sem Retenção de Receita'],'Classificação':['Tarja Vermelha']}),
    {required:true,retained:false,form:'Receita simples'});
  assert.deepEqual(facts({'Classificação':['Tarja Vermelha']}),{required:true,retained:null,form:null});
  assert.deepEqual(facts({'MedicamentoControlado':['Não']}),{required:null,retained:null,form:null});
  assert.equal(facts({'Retenção de Receita':['Sim']}).retained,true);
  assert.equal(facts({'Prescrição Médica':['Não'],'Retenção de Receita':['Sim']}).conflict,true);
});

test('compares retailer list codes with a verified rule for the ingredient and route', () => {
  const fields={'Princípio Ativo':['Com Clonazepam'],'Forma de Administração':['Sublingual','Via Oral'],
    'Prescrição Médica':['Com Retenção de Receita C1']};
  const card = medicationCard({sku:'12',name:'Exemplo',facts:fields});
  assert.deepEqual(card.prescriptionLabel,fields['Prescrição Médica']);
  assert.deepEqual(card.prescription.reportedLists,['C1']);
  assert.equal(card.prescription.required,true);
  assert.equal(card.prescription.retained,true);
  assert.equal(card.prescription.form,'Notificação de Receita B');
  assert.equal(card.prescription.catalogFormConflict,true);
  assert.ok(card.prescription.rule);
  for (const changes of [{'Forma de Administração':['Oral','Uso tópico']},{'Princípio Ativo':['Com Clonazepam','Outra substância']}]) {
    const unknown=medicationCard({name:'Medicamento',facts:{...fields,...changes}}).prescription;
    assert.equal(unknown.form,null);
    assert.equal(unknown.catalogFormConflict,undefined);
  }
});
