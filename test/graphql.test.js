import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCep, isNotFound, isNoNearbyStock, GraphQLError } from '../src/api/graphql.js';

test('normalizeCep strips punctuation and validates length', () => {
  assert.equal(normalizeCep('01001-000'), '01001000');
  assert.equal(normalizeCep(' 01001000 '), '01001000');
  assert.throws(() => normalizeCep('0100100'), /invalid CEP/);
  assert.throws(() => normalizeCep('abc'), /invalid CEP/);
});

test('isNotFound recognises the 404 carried in extensions.exception', () => {
  const stock = new GraphQLError([
    { message: 'Filial próxima sem estoque', extensions: { exception: { status: 404 } } },
  ]);
  const address = new GraphQLError([
    { message: 'Endereço não encontrado!', extensions: { exception: { status: 404 } } },
  ]);
  assert.equal(isNotFound(stock), true);
  assert.equal(isNotFound(address), true);
  assert.equal(isNoNearbyStock(address), false);
  assert.equal(isNoNearbyStock(stock), true);

  const other = new GraphQLError([{ message: 'Parâmetro inválido', extensions: {} }]);
  assert.equal(isNotFound(other), false);
  assert.equal(isNoNearbyStock(other), false);

  assert.equal(isNotFound(new Error('boom')), false);
  assert.equal(isNoNearbyStock(new Error('boom')), false);
});

test('isNoNearbyStock falls back to the message when the status is missing', () => {
  const err = new GraphQLError([{ message: 'Filial próxima sem estoque' }]);
  assert.equal(isNoNearbyStock(err), true);
  assert.equal(isNotFound(err), false);
});
