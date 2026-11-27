import test from 'node:test';
import assert from 'node:assert/strict';
import { medicationIntent, verifiedRow, medicationCatalog } from '../src/api/medication-catalog.js';

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
