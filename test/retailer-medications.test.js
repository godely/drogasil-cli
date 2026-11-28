import test from 'node:test';
import {nameIndex, resolveName} from '../src/api/medications.js';
import assert from 'node:assert/strict';
import { medicationIntent, nameChoices, verifiedRow, medicationCatalog } from '../src/api/medication-catalog.js';

const index = async () => ({ingredient:new Map([['morfina',['Sulfato de morfina']],['loratadina',['Loratadina']]]),brand:new Map()});
test('suggests known names without losing constraints or confirming an exact name again', async () => {
  assert.equal((await medicationIntent('morfi',index)).suggestions[0],'morfina');
  assert.equal((await medicationIntent('mrofina 10 mg/mL',index)).suggestions[0],'morfina 10 mg/ml');
  assert.deepEqual((await medicationIntent('morfina',index)).suggestions,[]);
  assert.deepEqual((await medicationIntent('xxzqvbrt',index)).suggestions,[]);
});
test('accepts identity evidence, rejects lookalikes, conflicting composition, and wrong dose', () => {
  const intent={kind:'ingredient',name:'morfina',suffix:'10 mg'};
  const match=(name, ingredients=[])=>verifiedRow({name},intent,{ingredients,evidence:{source:'retailer_field'}});
  assert.ok(match('Dimorf 10 mg',['Sulfato de morfina']));
  for(const title of ['Hidromorfina 10 mg','X sem morfina 10 mg','Morfina 10 mg/ml','Morfina 110mg']) assert.equal(match(title),undefined);
  assert.equal(match('Morfina 10mg',['Tramadol']),undefined);
});
test('declining a term returns refinements from verified products without repeating the term', async () => {
  const src=medicationCatalog({}, {intentFor:q=>medicationIntent(q,index),searchVerified:async()=>[{name:'Dimorf 10mg 50 comprimidos'}]});
  assert.deepEqual(await src.search('morfi'),[]);
  assert.deepEqual(await src.alternatives('morfi','morfina',7),['morfina 10 mg']);
});

test('an ambiguous prefix retains exact catalog brands and ingredients with the original presentation', async () => {
  const names = nameIndex([
    ['Dexametasona', 'Amoxicilina', 'Prednisona', 'Prednisolona', 'Paracetamol', 'Paracetamol+Cafeina'],
    ['Dexador', 'Dexason', 'Amoxil'],
  ]);
  const choices = query => nameChoices(query, {
    intentFor: term => medicationIntent(term, async () => names),
    resolve: async term => resolveName(term, names),
  });
  assert.deepEqual(await choices('dexa 4 mg'), ['dexametasona 4 mg', 'dexador 4 mg', 'dexason 4 mg']);
  assert.deepEqual(await choices('amoxic'), ['amoxicilina']);
  assert.deepEqual(await choices('paracet'), ['paracetamol']);
  assert.deepEqual(await choices('predniso'), ['prednisona', 'prednisolona']);
  assert.deepEqual(await choices('dexador 4 mg'), []);
});

test('a name index outage keeps plausible DCB choices available', async () => {
  const offline = async () => {throw new Error('catalog unavailable');};
  const choices = await nameChoices('predniso', {intentFor: term => medicationIntent(term, offline), resolve: offline});
  assert.ok(choices.includes('prednisona') && choices.includes('prednisolona'));
});

test('strong misspellings propose documented names and retain strength, route and pack for confirmation', async () => {
  const names = nameIndex([
    ['Hemitartarato de Zolpidem', 'Amoxicilina', 'Clonazepam', 'Dipirona Sódica'],
    ['Rivotril'],
  ]);
  const intentFor = query => medicationIntent(query, async () => names);
  const choices = query => nameChoices(query, {intentFor, resolve: async term => resolveName(term, names)});
  for (const [typed, expected] of [
    ['rhibotriu sublingual', 'rivotril sublingual'],
    ['zoupidenn 10 mg/ml 20 ml', 'zolpidem 10 mg/ml 20 ml'],
    ['amokssissilina', 'amoxicilina'], ['klohnazepann', 'clonazepam'], ['dippirronnah', 'dipirona'],
  ]) {
    assert.deepEqual(await choices(typed), [expected]);
    assert.deepEqual(await choices(expected), []);
  }
  assert.equal((await intentFor('zoupidenn')).kind, 'text');
  assert.deepEqual(await choices('qzambote'), []);
  assert.deepEqual(await choices('hidratante'), []);
  assert.match(resolveName('zolpidem', names).filters, /Hemitartarato de Zolpidem/);
  const catalog = medicationCatalog({}, {intentFor, searchVerified: () => assert.fail('searched before confirmation')});
  assert.deepEqual(await catalog.search('rhibotriu'), []);
});

test('both catalog identities survive an equal phonetic distance', async () => {
  const names = nameIndex([['Ribotril'], ['Rivotril']]);
  const intentFor = query => medicationIntent(query, async () => names);
  assert.deepEqual(await nameChoices('rhitotriuu', {intentFor, resolve: async t => resolveName(t, names)}),
    ['ribotril', 'rivotril']);
});

test('a literal retail brand and product line can resolve a non-medication prefix',async()=>{
  const rows=[
    {brand:'Ever Care',name:'Descongestionante Nasal Spray Ever Care 50ml'},
    {brand:'Ever Care',name:'Repelente Ever Care Spray 100ml'},
    {brand:'Outra',name:'Kit para Spray Nasal Ever Care 50ml'},
    {brand:'Ever Care',name:'Acessório para Spray Nasal Ever Care 50ml'},
  ];
  const intentFor=async query=>({kind:'text',name:'ever',suffix:query.slice(5),suggestions:['everolimo']});
  const adapter=medicationCatalog({}, {intentFor,searchVerified:async intent=>rows.filter(r=>verifiedRow(r,intent))});
  assert.deepEqual(await adapter.search('Ever Care spray nasal'),[rows[0]]);
  assert.deepEqual(await adapter.search('Ever Care spray nasal 50 mL'),[rows[0]]);
  for(const query of ['Ever Care spray nasal 100 mL','Ever Care spray nasal 2 mg','Ever 10mg','Ever']) {
    assert.deepEqual(await adapter.search(query),[]);
  }
});
