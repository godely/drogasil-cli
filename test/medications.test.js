import test from 'node:test';
import assert from 'node:assert/strict';
import { nameIndex, resolveName } from '../src/api/medications.js';
import { medicationIntent, nameChoices } from '../src/api/medication-catalog.js';

const index = nameIndex([
  ['Sulfato de Morfina Pentaidratado', 'Clonazepam', 'Cloridrato de Metformina', 'Paracetamol', 'Dipirona Sódica'],
  ['Frontal', 'Mounjaro', 'Tylenol'],
]);

test('translations and spelling corrections resolve to the same structured catalog filter', () => {
  for (const [query, expected] of [
    ['MÓRPHINE', 'morfina'], ['morphina', 'morfina'], ['clonazepan', 'clonazepam'],
    ['metimorfina', 'metformina'], ['acetaminophen', 'paracetamol'], ['metamizole', 'dipirona'],
    ['frantal', 'frontal'], ['monjauro', 'mounjaro'], ['frontol', 'frontal'],
    ['fronatl', 'frontal'], ['tilenol', 'tylenol'],
  ]) {
    const corrected = resolveName(query + ' 2mg', index);
    assert.equal(corrected.filters, resolveName(expected, index).filters);
    assert.equal(corrected.suffix, '2mg');
    assert.equal(corrected.interpretation.interpreted, expected + ' 2mg');
  }
});

test('ambiguous ingredient is returned for clarification', () => {
  assert.deepEqual(resolveName('tiptilina', index).ingredientCandidates, ['amitriptilina', 'nortriptilina']);
});

test('documented base names select only their own catalog salts', async () => {
  const salts = ['Oxalato de Escitalopram', 'Bromidrato de Citalopram', 'Citalopram', 'Rosuvastatina Cálcica'];
  const names = nameIndex([salts, []]);
  assert.deepEqual([...names.ingredient.get('escitalopram')], [salts[0]]);
  assert.deepEqual([...names.ingredient.get('citalopram')], salts.slice(1, 3));
  assert.deepEqual([...names.ingredient.get('rosuvastatina')], [salts[3]]);
  assert.equal(names.ingredient.has('oxalato'), false);
  for (const [typo, identity] of [['escitlaopram','escitalopram'], ['rosuvastatnia','rosuvastatina']]) {
    const choices = await nameChoices(typo, {intentFor:term=>medicationIntent(term, async()=>names),
      resolve:async term=>resolveName(term,names)});
    assert.deepEqual(choices,[identity]);
    const exact = resolveName(identity + ' 10 mg', names);
    assert.equal(exact.interpretation, undefined);
    assert.equal(exact.suffix, '10 mg');
    assert.equal(exact.filters, resolveName([...names.ingredient.get(identity)][0], names).filters);
  }
});

test('a retailer carrying only citalopram cannot reinterpret an official escitalopram request', async () => {
  const names = nameIndex([['Citalopram'], []]);
  for (const name of ['escitalopram', 'oxalato de escitalopram']) {
    assert.deepEqual(resolveName(name + ' 10 mg', names), {kind:'text', suffix:name+' 10 mg'});
  }
  const uncertainty = resolveName('escitlaopram 10 mg', names);
  assert.equal(uncertainty.filters, undefined);
  assert.deepEqual(uncertainty.nameCandidates,['escitalopram']);
  const options = await nameChoices('escitlaopram 10 mg', {
    intentFor:term=>medicationIntent(term, async()=>names), resolve:async term=>resolveName(term,names),
  });
  assert.deepEqual(options,['escitalopram 10 mg']);
});
