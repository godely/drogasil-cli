import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareExports} from '../scripts/compare-apify-export.mjs';

test('offer comparisons keep zero, false, nulls, omitted fields and observation times distinct', () => {
  const actor = {sku:'01', currentPrice:0, listPrice:null, inStock:false, scrapedAt:'2026-10-27T12:00:00Z'};
  const cli = {...actor, scrapedAt:'2026-10-27T12:02:00Z', stockSignal:0, currentPrice:null};
  const report = compareExports([actor], [cli]);
  assert.equal(report.matched, 1);
  assert.equal(report.fields.inStock.equal, 1);
  assert.equal(report.fields.listPrice.bothNull, 1);
  assert.equal(report.fields.productUrl.bothAbsent, 1);
  const [observation] = report.observations;
  assert.equal(observation.cliMinusActorSeconds, 120);
  assert.deepEqual(observation.differences.currentPrice, {actor:{state:'reported', value:0}, cli:{state:'null'}});
  assert.deepEqual(observation.differences.stockSignal, {actor:{state:'absent'}, cli:{state:'reported', value:0}});
});

test('counts exact identifiers and excludes duplicate observations on either side', () => {
  const rows = skus => skus.map(sku => ({sku}));
  const report = compareExports(rows(['01','1','2','2',null]), rows(['1','1','2','3','01',7]));
  assert.deepEqual(report.rows, {actor:5, cli:6});
  assert.deepEqual(report.unidentified, {actor:1, cli:1});
  assert.deepEqual(report.duplicateSkus, {actor:['2'], cli:['1']});
  assert.deepEqual(report.cliOnly, ['3']);
  assert.deepEqual(report.observations.map(row => row.sku), ['01']);
  assert.equal(report.observations[0].cliMinusActorSeconds, null);
  assert.deepEqual(compareExports(rows(['4']), []).actorOnly, ['4']);
  assert.throws(() => compareExports([], {records:[]}), /full JSON array/);
  assert.throws(() => compareExports([], [{sku:'1',retailerId:'paguemenos'}]), /only Drogasil/);
});
