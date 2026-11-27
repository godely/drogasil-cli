import { compareProducts, normalizeOrigin } from '../api/compare.js';
import { planPurchase, medicationType } from '../api/index.js';
import { renderPurchase, purchaseExitCode } from './plan.js';
import { formatPrice, printJson, table } from '../format.js';

export const usage = 'Usage: drogasil compare <medication name and strength | SKU> [--cep CEP | --lat LAT --lon LON] [--store nearest] [--json]';
export const options = {
  store: { type: 'string' },
  cep: { type: 'string' },
  lat: { type: 'string' },
  lon: { type: 'string' },
};

export async function run(positionals, values) {
  const query = positionals.join(' ').trim();
  if (!query) {
    process.stderr.write(usage + '\n');
    return 1;
  }
  let origin = null;
  try {
    if (values.cep != null || values.lat != null || values.lon != null) {
      origin = normalizeOrigin({ zipcode: values.cep, latitude: values.lat, longitude: values.lon });
    }
  } catch (err) {
    process.stderr.write(err.message + '\n');
    return 1;
  }
  if (values.store && (values.store !== 'nearest' || !origin)) {
    process.stderr.write('--store nearest requires a location.\n');
    return 1;
  }
  if (origin && !values.json) {
    const result = await planPurchase([query], { origin, store: values.store, expandSku: true });
    process.stdout.write(renderPurchase(result));
    return purchaseExitCode(result);
  }
  const { status, products = [], candidates, missingFields } = await compareProducts(query, { origin, store: values.store });
  if (values.json) printJson(products);
  if (status === 'incomplete_presentation') {
    process.stderr.write('Direct catalog hits only. Equivalence unverified: ' + missingFields.join(', ') + '.\n');
    if (origin && !products.length) {
      process.stderr.write('No direct catalog hits with nearby stock.\n');
      return 3;
    }
  } else if (status !== 'matches') {
    const messages = {
      conflicting_release: 'Conflicting release types. Specify one presentation.',
      no_reference: 'No matching reference product.',
      no_prices: 'No matching products with a reference price.',
      no_stock: 'No matching products with nearby stock.',
    };
    const message = status === 'ambiguous'
      ? 'Presentation unclear. Choose a more specific product by SKU:\n' + candidates.map(p => p.sku + '  ' + p.name + '  ' + medicationType(p)).join('\n')
      : messages[status];
    process.stderr.write(message + '\n');
    return 3;
  }
  if (values.json) return 0;
  process.stdout.write(table(['SKU', 'PRODUCT', 'Tipo', 'REFERENCE PRICE'],
    products.map(p => [p.sku, p.name, medicationType(p), formatPrice(p.price)])) + '\n');
  return 0;
}
