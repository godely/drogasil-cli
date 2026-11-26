import { compareProducts, normalizeOrigin } from '../api/compare.js';
import { formatAddress, formatKm, formatPrice, printJson, table } from '../format.js';

export const usage = 'Usage: drogasil compare <medication name and strength | SKU> [--cep CEP | --lat LAT --lon LON] [--json]';
export const options = {
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
  const { status, products = [], candidates } = await compareProducts(query, { origin });
  if (values.json) printJson(products);
  if (status !== 'matches') {
    const messages = {
      no_reference: 'No matching reference product.',
      no_prices: 'No matching products with a reference price.',
      no_stock: 'No matching products with nearby stock.',
    };
    const message = status === 'ambiguous'
      ? 'Presentation unclear. Choose a more specific product by SKU:\n' + candidates.map(p => p.sku + '  ' + p.name).join('\n')
      : messages[status];
    process.stderr.write(message + '\n');
    return 3;
  }
  if (values.json) return 0;
  if (!origin) {
    process.stdout.write(table(['SKU', 'PRODUCT', 'REFERENCE PRICE'],
      products.map(p => [p.sku, p.name, formatPrice(p.price)])) + '\n');
    return 0;
  }
  for (const product of products) {
    const rows = product.stores.map(store => [
      formatKm(store.distanceKMFromSearch), store.businessName, store.quantity, formatAddress(store.address),
    ]);
    process.stdout.write(`${formatPrice(product.price)} reference price  ${product.name} (SKU ${product.sku})\n`
      + table(['DIST', 'STORE', 'QTY', 'ADDRESS'], rows) + '\n\n');
  }
  return 0;
}
