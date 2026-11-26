import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table, formatPrice, formatKm, formatAddress, is24h, formatHours } from '../src/format.js';

test('table aligns columns and trims trailing whitespace', () => {
  const out = table(['A', 'BB'], [['1', 'x'], ['22', null]]);
  assert.equal(out, 'A   BB\n1   x\n22');
});

test('formatPrice uses Brazilian decimal comma and thousands separator', () => {
  assert.equal(formatPrice(61.73), 'R$ 61,73');
  assert.equal(formatPrice('4.99'), 'R$ 4,99');
  assert.equal(formatPrice(1779.43), 'R$ 1.779,43');
  assert.equal(formatPrice(1234567.5), 'R$ 1.234.567,50');
  assert.equal(formatPrice(null), '');
  assert.equal(formatPrice(''), '');
  assert.equal(formatPrice('abc'), '');
});

test('formatKm keeps three decimals', () => {
  assert.equal(formatKm(0.105), '0.105 km');
  assert.equal(formatKm(1.6540001), '1.654 km');
});

test('formatAddress matches the site layout', () => {
  assert.equal(
    formatAddress({ addressLocal: 'RUI BARBOSA', addressNumber: '633', district: 'GRAÇAS', city: 'RECIFE', sgState: 'PE' }),
    'RUI BARBOSA, 633 - GRAÇAS, RECIFE - PE',
  );
  assert.equal(formatAddress(null), '');
});

test('24h status is derived from hours, not flag24hours', () => {
  const allDay = { hourOpenNormaly: '00:01', hourEndNormaly: '23:59', flag24hours: 0 };
  const dayOnly = { hourOpenNormaly: '07:00', hourEndNormaly: '22:00', flag24hours: 1 };
  assert.equal(is24h(allDay), true);
  assert.equal(is24h(dayOnly), false);
  assert.equal(formatHours(allDay), '24h');
  assert.equal(formatHours(dayOnly), '07:00-22:00');
});
