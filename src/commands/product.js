import { getProductsBySku } from '../api/index.js';
import { medicationType } from '../api/product-info.js';
import { printJson, table, formatPrice } from '../format.js';

export const usage = `Usage: drogasil product <sku> [<sku>...] [--json]

Direct lookup by SKU. Prints name, brand, EAN and reference price.
Unknown SKUs are reported as "not found" (null in --json) and set exit
code 3. Price is Algolia's reference price; real prices vary by state
and store.`;

export const options = {};

const ATTRIBUTES = ['sku', 'name', 'brand', 'eanCode', 'price', 'status', 'isActive', 'url', 'filters', 'details'];

export async function run(positionals, values) {
  const skus = positionals.map((s) => s.trim()).filter(Boolean);
  if (skus.length === 0) {
    process.stderr.write(usage + '\n');
    return 1;
  }

  const results = await getProductsBySku(skus, values.json ? undefined : ATTRIBUTES);
  // One slot per requested SKU, even if the response came back short.
  const found = skus.map((_, i) => results[i] ?? null);
  const missing = found.some((p) => p == null);

  if (values.json) {
    printJson(found);
    return missing ? 3 : 0;
  }

  const rows = found.map((p, i) =>
    p
      ? [p.sku, p.name, medicationType(p), p.brand ?? '', p.eanCode ?? '', formatPrice(p.price), p.isActive === false ? 'inactive' : '']
      : [skus[i], 'not found', '', '', '', '', ''],
  );
  process.stdout.write(table(['SKU', 'NAME', 'TYPE', 'BRAND', 'EAN', 'PRICE', 'STATUS'], rows) + '\n');
  return missing ? 3 : 0;
}
