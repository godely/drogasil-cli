import { getProductsBySku, searchProducts } from './algolia.js';
import { getNearbyStockByLatLong, getNearbyStockByZipCode, normalizeCep, isNoNearbyStock } from './graphql.js';
import { parseCoords } from '../geo.js';

export function normalizeOrigin(origin) {
  if (origin == null) return null;
  const { zipcode, latitude, longitude } = origin;
  if (zipcode != null && latitude == null && longitude == null) return { zipcode: normalizeCep(zipcode) };
  if (zipcode == null && latitude != null && longitude != null) return parseCoords(latitude, longitude);
  throw new TypeError('use either --cep or both --lat and --lon');
}

async function compareNearby(products, origin) {
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
  return available;
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

export async function compareProducts(query, { origin = null } = {}) {
  if (!['string', 'number'].includes(typeof query) || !String(query).trim()) throw new TypeError('expected a medication name or SKU');
  origin = normalizeOrigin(origin);
  const refs = await referenceOptions(String(query).trim());
  if (!refs.length) return { status: 'no_reference', products: [] };
  const key = presentation(refs[0]);
  if (!key || refs.some(product => presentation(product) !== key)) {
    return { status: 'ambiguous', candidates: refs };
  }
  const search = refs[0].details.activeIngredients[0].description;
  const matches = new Map();
  for (const product of [...refs, ...await searchAll(search)]) {
    if (product.isActive === false || presentation(product) !== key ||
        !Number.isFinite(product.price) || product.price <= 0) continue;
    matches.set(String(product.sku), product);
  }
  const sorted = [...matches.values()].sort((a, b) => a.price - b.price || String(a.sku).localeCompare(String(b.sku)));
  if (!sorted.length) return { status: 'no_prices', products: [] };
  const products = origin ? await compareNearby(sorted, origin) : sorted;
  return { status: products.length ? 'matches' : 'no_stock', products };
}
