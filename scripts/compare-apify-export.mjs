// Compare a JSON dataset downloaded from the Drogasil Actor with our full JSON export.
// Each observation retains its date so a later price change remains visible.
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const fields = [
  'name', 'brand', 'categories', 'categoryPath', 'productUrl', 'currentPrice', 'listPrice',
  'discountPercentage', 'currency', 'inStock', 'stockSignal', 'searchQuery', 'sourceUrl',
];

function index(rows, source) {
  if (!Array.isArray(rows)) throw new Error(source + ': expected a full JSON array of records');
  const unique = new Map();
  const duplicates = new Set();
  let unidentified = 0;
  for (const row of rows) {
    if (row?.retailerId && row.retailerId !== 'drogasil') throw new Error(source + ': expected only Drogasil records');
    if (typeof row?.sku !== 'string' || !row.sku.trim()) {
      unidentified++;
      continue;
    }
    if (unique.has(row.sku)) duplicates.add(row.sku);
    else unique.set(row.sku, row);
  }
  return {unique, duplicates, unidentified};
}

function value(row, key) {
  if (!Object.hasOwn(row, key)) return {state:'absent'};
  if (row[key] === null) return {state:'null'};
  return {state:'reported', value:row[key]};
}

export function compareExports(actorRows, cliRows) {
  const actor = index(actorRows, 'Actor');
  const cli = index(cliRows, 'CLI');
  const report = {
    rows:{actor:actorRows.length, cli:cliRows.length},
    unidentified:{actor:actor.unidentified, cli:cli.unidentified},
    duplicateSkus:{actor:[...actor.duplicates], cli:[...cli.duplicates]},
    actorOnly:[], cliOnly:[], matched:0, fields:{}, observations:[],
  };
  for (const key of fields) report.fields[key] = {equal:0, different:0, bothNull:0, bothAbsent:0};
  for (const [sku, first] of actor.unique) {
    const second = cli.unique.get(sku);
    if (!second) { report.actorOnly.push(sku); continue; }
    if (actor.duplicates.has(sku) || cli.duplicates.has(sku)) continue;
    report.matched++;
    const actorTime = first.scrapedAt, cliTime = second.scrapedAt;
    const elapsedMs = Date.parse(cliTime) - Date.parse(actorTime);
    const differences = {};
    for (const key of fields) {
      const a = value(first, key), b = value(second, key);
      const counts = report.fields[key];
      if (!isDeepStrictEqual(a,b)) {
        counts.different++;
        differences[key] = {actor:a, cli:b};
      } else if (a.state === 'absent') counts.bothAbsent++;
      else if (a.state === 'null') counts.bothNull++;
      else counts.equal++;
    }
    report.observations.push({
      sku, actorTime:actorTime ?? null, cliTime:cliTime ?? null,
      cliMinusActorSeconds:Number.isFinite(elapsedMs) ? elapsedMs / 1000 : null, differences,
    });
  }
  report.cliOnly = [...cli.unique.keys()].filter(sku => !actor.unique.has(sku));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {positionals} = parseArgs({allowPositionals:true});
    if (positionals.length !== 2) throw new Error('Usage: node scripts/compare-apify-export.mjs ACTOR.json CLI.json');
    const datasets = await Promise.all(positionals.map(async path => JSON.parse(await readFile(path, 'utf8'))));
    console.log(JSON.stringify(compareExports(...datasets), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
