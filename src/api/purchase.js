import { compareProducts, normalizeOrigin } from './compare.js';
import { getNearbyStockByLatLong, getNearbyStockByZipCode, GraphQLError, listStores } from './graphql.js';
import { productInfo } from './product-info.js';
import { fold } from './medications.js';
import { optimizePlans } from './purchase-plans.js';

export function tableLabel(index) {
  let label = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

function normalizeItem(input) {
  const item = typeof input === 'string' ? { query: input } : input;
  if (typeof item?.query !== 'string' || !item.query.trim()) throw new TypeError('Each item needs a medication name or SKU');
  const { quantity = 1, brand, genericOnly = false, selectedSku } = item;
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new TypeError('quantity must be a positive integer');
  if (brand != null && (typeof brand !== 'string' || !brand.trim())) throw new TypeError('brand must be a name');
  if (typeof genericOnly !== 'boolean') throw new TypeError('genericOnly must be a boolean');
  if (selectedSku != null && !/^\d+$/.test(selectedSku)) throw new TypeError('selectedSku must be numeric');
  return { query: item.query.trim(), quantity, brand: brand?.trim(), genericOnly,
    selectedSku: selectedSku == null ? undefined : String(selectedSku) };
}

function memoizeRequest(read) {
  const cache = new Map();
  return key => {
    if (!cache.has(key)) cache.set(key, read(key));
    return cache.get(key);
  };
}

async function inventory(sku, origin) {
  let rows;
  try {
    rows = origin.zipcode ? await getNearbyStockByZipCode({ ...origin, sku }) :
      await getNearbyStockByLatLong({ ...origin, sku });
  } catch (error) {
    if (error instanceof GraphQLError && error.errors.every(e => /sem estoque/i.test(e.message))) {
      return { stores: [], emptyConfirmed: true };
    }
    return { stores: [], failed: true };
  }
  const stores = rows.map(({ branch, stocks }) => {
    const quantity = stocks?.find(s => String(s.sku) === sku)?.quantity;
    const distance = branch.distanceKMFromSearch;
    return { id: String(branch.id), name: branch.businessName, address: branch.address,
      distanceKm: distance != null && distance !== '' && Number.isFinite(Number(distance)) ? Number(distance) : null,
      quantity: Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null };
  });
  stores.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  return { stores };
}

function catalogCandidates(result) {
  return (result.candidates ?? result.groups?.flat() ?? []).map(productInfo);
}

async function prepareItem(item, label, catalog, expandSku) {
  const table = { label, ...item, status: 'matches', rows: [], unavailable: [], unknown: [], failed: [] };
  let result;
  try { result = await catalog(item.query); } catch {
    table.status = 'catalog_lookup_failed';
    return { table, products: [] };
  }
  table.status = result.status;
  if (result.interpretation) table.interpretation = result.interpretation;
  if (result.missingFields) table.missingFields = result.missingFields;
  let products = result.products;
  const candidates = catalogCandidates(result);
  if (!products && item.selectedSku && candidates.some(c => c.sku === item.selectedSku)) {
    try {
      const selected = await catalog(item.selectedSku);
      products = selected.products;
      table.status = selected.status;
      if (selected.missingFields) table.missingFields = selected.missingFields;
    } catch { table.status = 'catalog_lookup_failed'; }
  }
  if (!products?.length) {
    if (candidates.length) table.candidates = candidates;
    if (result.nameCandidates || result.ingredientCandidates) table.nameCandidates = result.nameCandidates ?? result.ingredientCandidates;
    return { table, products: [] };
  }
  // A literal SKU is a purchase preference. compareProducts itself still
  // expands exact SKUs for existing catalog-comparison callers.
  const requiredSku = item.selectedSku ?? (!expandSku && /^\d+$/.test(item.query) ? item.query : null);
  const filtered = products.filter(p => {
    if (requiredSku && String(p.sku) !== requiredSku) return false;
    if (item.genericOnly && productInfo(p).type !== 'Genérico') return false;
    if (!item.brand) return true;
    return [p.brand, p.filters?.Marca, p.details?.marca].flat().some(name => name && fold(name) === fold(item.brand));
  });
  if (!filtered.length) table.status = 'preference_unavailable';
  return { table, products: filtered };
}

function populate(table, products, stocks, fixed, nearestId, choices) {
  let number = 0;
  for (const p of products) {
    const product = productInfo(p);
    const data = stocks.get(product.sku);
    const window = fixed ? data.stores.filter(s => s.id === nearestId) : data.stores;
    const stocked = window.filter(s => s.quantity != null && s.quantity >= table.quantity);
    const nearest = stocked[0];
    const option = nearest ? table.label + (++number) : null;
    if (nearest || fixed) table.rows.push({ ...product, option, store: nearest ?? window[0] ?? null });
    if (!nearest) {
      if (data.failed) table.failed.push(product);
      else if (window.some(s => s.quantity == null) || (!window.length && (fixed || !data.emptyConfirmed))) table.unknown.push(product);
      else table.unavailable.push(product);
      continue;
    }
    for (const store of stocked) {
      const unit = product.referencePriceBRL;
      choices.push({ table: table.label, option, sku: product.sku, name: product.name, type: product.type,
        packs: table.quantity, unitPriceBRL: unit, store, cost: unit == null ? Infinity : Math.round(unit * 100) * table.quantity });
    }
  }
}

async function branchCoordinates() {
  const coordinates = new Map();
  for (const branch of await listStores()) {
    const { latitude, longitude } = branch.address ?? {};
    if ([latitude, longitude].some(n => n == null || String(n).trim() === '' || !Number.isFinite(Number(n)))) continue;
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      coordinates.set(String(branch.id), { latitude: Number(latitude), longitude: Number(longitude) });
    }
  }
  return coordinates;
}

export async function planPurchase(items, { origin, store, expandSku = false } = {}) {
  origin = normalizeOrigin(origin);
  if (!origin) throw new TypeError('Supply a CEP or coordinates for a purchase plan');
  if (!Array.isArray(items) || !items.length) throw new TypeError('Supply at least one medication');
  if (store != null && store !== 'nearest') throw new TypeError('store must be nearest or omitted');
  const catalog = memoizeRequest(query => compareProducts(query, { resolveNames: true, includeUnpriced: true }));
  const prepared = await Promise.all(items.map(normalizeItem).map((item, i) => prepareItem(item, tableLabel(i), catalog, expandSku)));
  const skus = new Set(prepared.flatMap(({ products }) => products.map(p => String(p.sku))));
  const stocks = new Map(await Promise.all([...skus].map(async sku => [sku, await inventory(sku, origin)])));
  const nearestStore = [...stocks.values()].find(data => data.stores.length)?.stores[0];
  const tables = prepared.map(p => p.table);
  const lines = prepared.map(({ table, products }) => {
    const choices = [];
    populate(table, products, stocks, store === 'nearest', nearestStore?.id, choices);
    // Several incomplete direct hits can be shown, but the user must select
    // a SKU before one of them is used as a substitute in a shopping plan.
    if (products.length > 1 && table.status === 'incomplete_presentation' && items.length > 1) {
      table.needsSelection = true;
      choices.length = 0;
    }
    return { label: table.label, quantity: table.quantity, choices };
  });
  const eligible = lines.filter(line => line.choices.length);
  let optimized = { plans: [], searchComplete: true };
  let directoryFailed = false;
  if (items.length > 1 && eligible.length) {
    let coordinates = new Map();
    if (eligible.length > 1 && store !== 'nearest' && new Set(eligible.flatMap(l => l.choices.map(c => c.store.id))).size > 1) {
      try { coordinates = await branchCoordinates(); } catch { directoryFailed = true; }
    }
    optimized = optimizePlans(lines, coordinates);
  }
  const { plans } = optimized;
  const [fewest, cheapest] = plans;
  let tradeoff;
  if (cheapest && fewest.totalBRL != null && cheapest.totalBRL != null &&
      fewest.unfilled.join() === cheapest.unfilled.join()) {
    tradeoff = { savingsBRL: Math.round((fewest.totalBRL - cheapest.totalBRL) * 100) / 100,
      extraStops: cheapest.stopCount - fewest.stopCount, extraKm: cheapest.roundTripKm == null || fewest.roundTripKm == null ?
        null : cheapest.roundTripKm - fewest.roundTripKm };
  }
  const covered = items.length === 1 ? eligible.length : (fewest ? items.length - fewest.unfilled.length : 0);
  return { status: covered === items.length ? 'complete' : covered ? 'partial' : 'unfilled',
    scope: store ?? 'nearest_stocked_per_option', checkedAt: new Date().toISOString(), tables,
    ...(store === 'nearest' && nearestStore ? { fixedBranchId: nearestStore.id } : {}),
    ...optimized, tradeoff, directoryFailed,
    ...(items.length > 1 ? { planGuidance: 'Use the exact plan label. Describe travel and stops only for the pickups in a returned plan. Each table row hides other stocked branches. For unselected alternatives, offer the option ID and wait for a preference before stating their stop count, itinerary or distance.' } : {}),
    stockIncomplete: tables.some(t => t.unknown.length || t.failed.length || t.status === 'catalog_lookup_failed'),
    priceIncomplete: eligible.some(line => line.choices.some(c => !Number.isFinite(c.cost))) };
}
