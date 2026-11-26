import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinNegativeNumbers } from '../src/cli.js';

test('joinNegativeNumbers glues negative coordinate values to their flag', () => {
  assert.deepEqual(
    joinNegativeNumbers(['110166', '--lat', '-23.5500', '--lon', '-46.630', '--json']),
    ['110166', '--lat=-23.5500', '--lon=-46.630', '--json'],
  );
});

test('joinNegativeNumbers leaves everything else alone', () => {
  const args = ['--cep', '01001000', '--min-qty', '2', '-h', '--all', '--lat=-1'];
  assert.deepEqual(joinNegativeNumbers(args), args);
  // A flag followed by another flag is not a value.
  assert.deepEqual(joinNegativeNumbers(['--lat', '--lon']), ['--lat', '--lon']);
  // Positive numbers do not need rewriting.
  assert.deepEqual(joinNegativeNumbers(['--limit', '5']), ['--limit', '5']);
});
