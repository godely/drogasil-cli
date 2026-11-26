import { listStores } from '../api/index.js';
import { printJson, table } from '../format.js';

export const usage = `Usage: drogasil stores [--json]

Full Drogasil store directory (~2300 stores) with coordinates. The \`id\`
column matches \`branch.id\` in stock results.`;

export const options = {};

export async function run(_positionals, values) {
  const stores = await listStores();

  if (values.json) {
    printJson(stores);
    return 0;
  }

  const rows = stores.map((s) => [
    s.id,
    s.storeName,
    [s.address?.street, s.address?.number].filter(Boolean).join(', '),
    s.address?.latitude,
    s.address?.longitude,
  ]);
  process.stdout.write(table(['ID', 'NAME', 'ADDRESS', 'LAT', 'LON'], rows) + '\n');
  process.stdout.write(`\n${stores.length} stores\n`);
  return 0;
}
