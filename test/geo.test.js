import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, parseCoords } from '../src/geo.js';

test('haversine is zero for identical points and ~111.2 km per degree of latitude', () => {
  const origin = { latitude: -23.55, longitude: -46.630 };
  assert.equal(haversineKm(origin, origin), 0);

  const oneDegreeNorth = haversineKm(origin, { ...origin, latitude: origin.latitude + 1 });
  assert.ok(Math.abs(oneDegreeNorth - 111.2) < 0.5, `expected ~111.2 km, got ${oneDegreeNorth}`);
});

test('parseCoords accepts strings and rejects out-of-range values', () => {
  assert.deepEqual(parseCoords('-23.5500', '-46.630'), {
    latitude: -23.55,
    longitude: -46.630,
  });
  assert.throws(() => parseCoords('91', '0'), /invalid latitude/);
  assert.throws(() => parseCoords('0', '181'), /invalid longitude/);
  assert.throws(() => parseCoords('abc', '0'), /invalid latitude/);
});

test('parseCoords rejects blank input instead of treating it as 0', () => {
  assert.throws(() => parseCoords('', '-34.9'), /invalid latitude/);
  assert.throws(() => parseCoords('-8.0', '  '), /invalid longitude/);
});
