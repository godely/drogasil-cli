import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMedicationInfo } from '../src/api/index.js';
import { prescriptionInfo, brazilianPresentations } from '../src/api/regulatory-info.js';

test('SKU facts omit prices, keep liquid units, resolve sublingual administration and separate prescription evidence', async t => {
  const products = [
    ['11', 'Rivotril solução oral', 'Solução', 'Clonazepam', 2.5, 'TARJA PRETA COM RETENCAO DA RECEITA', 'Rivotril 2,5MG/ML'],
    ['12', 'Rivotril 0,25mg', 'Comprimido sublingual', 'Clonazepam', 0.25, '', ''],
    ['13', 'Tansulosina 0,4 mg', 'Cápsula', 'Cloridrato de Tansulosina', 0.4, 'TARJADO EM VERMELHO SEM RETENCAO DA RECEITA', 'Venda sob prescrição médica'],
    ['14', 'Outro gotas', 'Solução', 'Outro', 5, '', ''],
  ];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, { body }) => {
    assert.match(url, /objects$/);
    const [req] = JSON.parse(body).requests;
    assert.ok(!req.attributesToRetrieve.includes('price'));
    calls.push(req.objectID);
    const [sku, name, form, ingredient, dosageValue, stripe, description] = products.find(p => p[0] === req.objectID);
    return Response.json({ results: [{ sku, name, description, filters: { 'Forma farmacêutica': form, 'Via de administração': 'Uso oral' },
      details: { descricao_tarja: stripe, activeIngredients: [{ description: ingredient, dosageValue, unitOfMeasurement: { name: 'MG' } }] } }] });
  });
  const { results } = await getMedicationInfo(['11', '12', '13', '14']);
  assert.equal(results[0].products[0].ingredients[0].strength, '2,5 mg/mL');
  assert.equal(results[1].products[0].route, 'Sublingual');
  assert.equal(results[1].products[0].prescription.form, 'Notificação de Receita B');
  assert.deepEqual(results[2].products[0].prescription, { required: true, retained: false, form: 'Receita simples' });
  assert.deepEqual(results[3].products[0].prescription, { required: null, retained: null, form: null });
  assert.equal(results[3].products[0].ingredients[0].strength, null);
  assert.deepEqual(calls, ['11', '12', '13', '14']);
});

test('national answers retain leaflet sources, release and strength filters', async () => {
  const r = await brazilianPresentations('Frontal XR 2 mg', { name: 'Frontal XR', suffix: '2 mg' });
  assert.deepEqual(r.presentations.map(p => [p.strength, p.release]), [['2 mg', 'prolongada']]);
  assert.match(r.presentations[0].source, /12145378/);
  assert.equal(prescriptionInfo('COM RETENCAO DA RECEITA', 'Venda sem prescrição', [], null).conflict, true);
  assert.equal(prescriptionInfo('', '', ['Isotretinoína'], 'Tópico').form, null);
});

test('one failed catalog request preserves the other factual answers and missing slots', async t => {
  const {infoExitCode, renderInfoResult} = await import('../src/commands/info-result.js');
  t.mock.method(globalThis, 'fetch', async (_, {body}) => {
    const id = JSON.parse(body).requests[0].objectID;
    if (id === '11') return Response.json({error:'temporarily offline'});
    if (id === '12') return Response.json({results:[null]});
    return Response.json({results:[{sku:id, name:'Produto de teste', details:{quantidade:'20 comprimidos'}}]});
  });
  const {results} = await getMedicationInfo(['11','12','13']);
  assert.deepEqual(results.map(r => r.status), ['source_failed','no_reference','matches']);
  assert.equal(infoExitCode(results), 2);
  assert.match(renderInfoResult(results[0],'Drogasil'), /Falha ao consultar/);
  assert.match(renderInfoResult(results[1],'Drogasil'), /Nenhuma apresentação/);
  assert.match(renderInfoResult(results[2],'Drogasil'), /Embalagem: 20 comprimidos/);
});
