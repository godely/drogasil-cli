import test from 'node:test';
import assert from 'node:assert/strict';
import { nameIndex, resolveName } from '../src/api/medications.js';

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
