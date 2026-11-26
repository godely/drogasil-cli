import { getProductsBySku, searchProducts, getNearbyStockByZipCode, getNearbyStockByLatLong, normalizeCep, isNoNearbyStock } from '../api/index.js';
import { parseCoords } from '../geo.js';
import { formatAddress, formatKm, formatPrice, printJson, table } from '../format.js';

export const usage = 'Usage: drogasil compare <medication name and strength | SKU> [--cep CEP | --lat LAT --lon LON] [--json]';
export const options = {
  cep: { type: 'string' },
  lat: { type: 'string' },
  lon: { type: 'string' },
};

function parseOrigin({ cep, lat, lon }) {
  if (lat != null || lon != null) {
    if (cep != null || lat == null || lon == null) throw new Error('use either --cep or both --lat and --lon');
    return parseCoords(lat, lon);
  }
  return cep == null ? null : { zipcode: normalizeCep(cep) };
}

async function compareNearby(products, origin, json) {
  const available = [];
  for (const product of products) {
    const request = { ...origin, sku: product.sku, quantity: 1 };
    let rows;
    try {
      rows = origin.zipcode
        ? await getNearbyStockByZipCode(request)
        : await getNearbyStockByLatLong(request);
    } catch (err) {
      if (isNoNearbyStock(err)) continue;
      throw err;
    }
    const stores = [];
    for (const { branch, stocks } of rows) {
      const stock = stocks?.find(item => String(item.sku) === String(product.sku));
      if (stock?.quantity > 0) stores.push({ ...branch, quantity: stock.quantity });
    }
    if (stores.length) available.push({ ...product, stores });
  }
  if (json) printJson(available);
  else for (const product of available) {
    const rows = product.stores.map(store => [
      formatKm(store.distanceKMFromSearch), store.businessName, store.quantity, formatAddress(store.address),
    ]);
    process.stdout.write(`${formatPrice(product.price)} reference price  ${product.name} (SKU ${product.sku})\n`
      + table(['DIST', 'STORE', 'QTY', 'ADDRESS'], rows) + '\n\n');
  }
  if (!available.length) process.stderr.write('No matching products with nearby stock.\n');
  return available.length ? 0 : 3;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(?=mg|mcg|ml|g\b)/g, '$1')
    .replace(/(\d)\.0+(?=[a-z\s]|$)/g, '$1').trim().replace(/\s+/g, ' ');
}

function presentation(product) {
  const ingredients = product.details?.activeIngredients;
  const form = normalize(product.filters?.['Forma farmacêutica']);
  const pack = normalize(product.details?.quantidade);
  if (!Array.isArray(ingredients) || !ingredients.length || !form || !/^\d/.test(pack)) return null;
  if (product.details.activeNumberIngredient != null &&
      Number(product.details.activeNumberIngredient) !== ingredients.length) return null;

  const doses = [];
  for (const ingredient of ingredients) {
    const name = normalize(ingredient?.description);
    const unit = normalize(ingredient?.unitOfMeasurement?.name);
    const dose = Number(String(ingredient?.dosageValue).replace(',', '.'));
    if (!name || !unit || !Number.isFinite(dose) || dose <= 0) return null;
    doses.push(JSON.stringify([name, dose, unit]));
  }
  const label = normalize([product.name, product.brand, form, pack].join(' '));
  const markers = label.match(/\b(?:xr|xl|sr|cr|er|dr|la|lp|mr|retard|chrono|depot|orodispersivel|sublingual|mastigavel|efervescente|gastrorresistente|liberacao (?:prolongada|modificada|controlada|retardada|lenta|bifasica))\b/g) ?? [];
  return JSON.stringify([doses.sort(), form, pack, normalize(product.filters?.['Via de administração']), [...new Set(markers)].sort()]);
}

async function searchAll(query) {
  const first = await searchProducts(query, { hitsPerPage: 100 });
  const hits = [...first.hits];
  for (let page = 1; page < first.nbPages; page++) {
    hits.push(...(await searchProducts(query, { hitsPerPage: 100, page })).hits);
  }
  return hits;
}

async function referenceOptions(query) {
  if (/^\d+$/.test(query)) return (await getProductsBySku([query])).filter(Boolean);
  const terms = normalize(query).match(/[\p{L}\d.]+/gu) ?? [];
  if (!terms.length) return [];
  const candidates = (await searchAll(query)).filter(product => {
    const words = normalize(product.name).match(/[\p{L}\d.]+/gu) ?? [];
    return terms.every(term => words.includes(term));
  });
  const exact = candidates.filter(product => {
    const brandDose = [product.brand, ...(product.details?.dosageList ?? [])].join(' ');
    return [product.name, brandDose].some(value => normalize(value) === normalize(query));
  });
  return exact.length ? exact : candidates;
}

export async function run(positionals, values) {
  const query = positionals.join(' ').trim();
  if (!query) {
    process.stderr.write(usage + '\n');
    return 1;
  }
  let origin;
  try {
    origin = parseOrigin(values);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    return 1;
  }
  const refs = await referenceOptions(query);
  const key = refs.length && presentation(refs[0]);
  if (!key || refs.some(product => presentation(product) !== key)) {
    process.stderr.write(refs.length
      ? 'Presentation unclear. Choose a more specific product by SKU:\n' + refs.map(p => p.sku + '  ' + p.name).join('\n') + '\n'
      : 'No matching reference product.\n');
    if (values.json) printJson([]);
    return 3;
  }
  const search = refs[0].details.activeIngredients[0].description;
  const matches = new Map();
  for (const product of [...refs, ...await searchAll(search)]) {
    if (product.isActive === false || presentation(product) !== key ||
        !Number.isFinite(product.price) || product.price <= 0) continue;
    matches.set(String(product.sku), product);
  }
  const sorted = [...matches.values()].sort((a, b) => a.price - b.price || String(a.sku).localeCompare(String(b.sku)));
  if (origin && sorted.length) return compareNearby(sorted, origin, values.json);
  if (values.json) printJson(sorted);
  else if (sorted.length) process.stdout.write(table(['SKU', 'PRODUCT', 'REFERENCE PRICE'],
    sorted.map(p => [p.sku, p.name, formatPrice(p.price)])) + '\n');
  if (!sorted.length) process.stderr.write('No matching products with a reference price.\n');
  return sorted.length ? 0 : 3;
}
