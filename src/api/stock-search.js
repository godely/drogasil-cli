// The stock service returns windows of participating branches. A directory
// lookup and additional windows are only needed after the user accepts.
import { getNearbyStockByLatLong, getNearbyStockByZipCode, isNoNearbyStock, listStores } from './graphql.js';
import { getProductsBySku } from './algolia.js';
import { haversineKm } from '../geo.js';

export const STOCK_RADIUS_KM = 25;
const RESULT_LIMIT = 10;

export function stockQuantity(row, sku) {
  const value = row.stocks?.find(stock => String(stock.sku) === sku)?.quantity;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function number(value) {
  if (value == null || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function readWindow(sku, origin, maxBranches) {
  try {
    const params = { sku, ...origin, maxBranches };
    return { rows: origin.zipcode ? await getNearbyStockByZipCode(params) : await getNearbyStockByLatLong(params) };
  } catch (error) {
    if (isNoNearbyStock(error)) return { rows: [], emptyConfirmed: true };
    throw error;
  }
}

function nearbyCoverage(windows, allowExpansion) {
  const branches = new Map();
  let allZero = windows.size > 0;
  let stockUnknown = false;
  for (const [sku, { rows, emptyConfirmed }] of windows) {
    if (!rows.length && !emptyConfirmed) stockUnknown = true;
    if (!rows.length) allZero = false;
    for (const row of rows) {
      const quantity = stockQuantity(row, sku);
      if (row.branch?.id == null || quantity == null) stockUnknown = true;
      if (quantity !== 0 || row.branch?.id == null) allZero = false;
      if (row.branch?.id != null) branches.set(String(row.branch.id), number(row.branch.distanceKMFromSearch));
    }
  }
  const distances = [...branches.values()];
  const radiusKm = distances.length && distances.every(d => d != null && d >= 0) ? Math.max(...distances) : null;
  // Every requested SKU must have an explicit zero at every counted branch.
  const sameWindow = [...windows.values()].every(w => new Set(w.rows.map(r => String(r.branch?.id))).size === branches.size);
  return { checkedStores: branches.size, radiusKm, stockUnknown: stockUnknown || !sameWindow, allZero: allZero && sameWindow,
    canExpand: Boolean(allowExpansion && allZero && sameWindow && (radiusKm == null || radiusKm < STOCK_RADIUS_KM)) };
}

function directoryPoint(store) {
  const latitude = number(store.address?.latitude), longitude = number(store.address?.longitude);
  return latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}

// For a CEP the retailer supplies distances, but no origin coordinates. Each
// initial store gives triangle-inequality bounds on other stores' distances.
// The interval includes a small tolerance for rounded upstream distances.
function distanceBounds(point, origin, anchors) {
  if (origin.zipcode == null) {
    const distance = haversineKm(origin, point);
    return [distance, distance];
  }
  let lower = 0, upper = Infinity;
  for (const anchor of anchors) {
    const d = haversineKm(anchor.point, point);
    lower = Math.max(lower, Math.abs(d - anchor.distance) - 0.005);
    upper = Math.min(upper, d + anchor.distance + 0.005);
  }
  return [lower, upper];
}

function contact(store) {
  const local = String(store.telephone ?? '').trim();
  const area = String(store.telephoneAreaCode ?? '').trim();
  if (/^\d{2}$/.test(area) && /^\d{8,9}$/.test(local)) return '(' + area + ') ' + local.slice(0, -4) + '-' + local.slice(-4);
  return null;
}

async function widerSearch(windows, minimums, origin) {
  const result = { radiusKm: STOCK_RADIUS_KM, checkedStores: 0, partial: false, stores: [],
    totalStockedStores: 0, distanceEstimated: Boolean(origin.zipcode), advice: 'Ligue para a filial antes de sair para confirmar o estoque.' };
  const directory = await listStores();
  const points = new Map(directory.map(s => [String(s.id), directoryPoint(s)]));
  const seen = new Map();
  const anchors = [];
  for (const [sku, { rows }] of windows) {
    seen.set(sku, new Map(rows.map(r => [String(r.branch.id), r])));
  }
  for (const row of windows.values().next().value.rows) {
    const point = points.get(String(row.branch.id)), distance = number(row.branch.distanceKMFromSearch);
    if (point && distance != null && distance >= 0) anchors.push({ point, distance });
  }
  if (!directory.length || (origin.zipcode && !anchors.length)) return { ...result, partial: true };
  const candidates = [];
  for (const store of directory) {
    const id = String(store.id);
    const point = points.get(id);
    if (!point) { result.partial = true; continue; }
    const [lower, upper] = distanceBounds(point, origin, anchors);
    if (lower > upper) { result.partial = true; continue; }
    if (lower <= STOCK_RADIUS_KM) candidates.push({ id, store, point, lower, upper });
  }
  candidates.sort((a, b) => a.lower - b.lower || a.id.localeCompare(b.id));
  // Windows overlap. Only center a new call on a branch whose stock for
  // this SKU is still unknown. Quantities from a different SKU never count.
  const failedSkus = new Set();
  for (const c of candidates) {
    if (c.upper > STOCK_RADIUS_KM) continue;
    for (const [sku, records] of seen) {
      if (records.has(c.id) || failedSkus.has(sku)) continue;
      try {
        const rows = await getNearbyStockByLatLong({ sku, ...c.point });
        if (!rows.length) result.partial = true;
        for (const row of rows) {
          if (row.branch?.id != null) records.set(String(row.branch.id), row);
        }
      } catch {
        result.partial = true;
        failedSkus.add(sku);
      }
    }
  }
  for (const c of candidates) {
    const stocks = [];
    let branch;
    for (const [sku, records] of seen) {
      const row = records.get(c.id);
      if (!row) {
        if (c.upper > STOCK_RADIUS_KM) result.partial = true;
        continue; // absent even from a successful self-centered window: nonparticipating
      }
      branch = row.branch;
      const quantity = stockQuantity(row, sku);
      if (quantity == null) result.partial = true;
      else if (quantity >= minimums.get(sku)) stocks.push({ sku, quantity });
    }
    if (c.upper > STOCK_RADIUS_KM) {
      if (stocks.length) result.partial = true; // cannot verify inclusion at the CEP boundary
      continue;
    }
    if (branch) result.checkedStores++;
    if (stocks.length) {
      const distanceKm = (c.lower + c.upper) / 2;
      result.stores.push({ id: c.id, name: branch.businessName, address: branch.address, distanceKm,
        phone: contact(c.store), stocks });
    }
  }
  result.stores.sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
  result.totalStockedStores = result.stores.length;
  // Keep the caller's row contract, using distances from the user's origin.
  // The original zero rows also remain available for nearestStore.
  for (const store of result.stores) {
    for (const { sku } of store.stocks) {
      const row = seen.get(sku).get(store.id);
      const rows = windows.get(sku).rows;
      const updated = { ...row, branch: { ...row.branch, distanceKMFromSearch: store.distanceKm, phone: store.phone } };
      const index = rows.findIndex(r => String(r.branch.id) === store.id);
      if (index < 0) rows.push(updated);
      else rows[index] = updated;
    }
  }
  result.stores = result.stores.slice(0, RESULT_LIMIT);
  return result;
}

export async function searchStockWindows(minimums, origin, {
  expandSearch = false, allowExpansion = true, verifySku = false, tolerateErrors = false, maxBranches = 30,
} = {}) {
  if (typeof expandSearch !== 'boolean') throw new TypeError('expandSearch must be boolean');
  const windows = new Map(await Promise.all([...minimums.keys()].map(async sku => {
    try { return [sku, await readWindow(sku, origin, maxBranches)]; }
    catch (error) {
      if (!tolerateErrors) throw error;
      return [sku, { rows: [], failed: true }];
    }
  })));
  const coverage = nearbyCoverage(windows, allowExpansion);
  let unknownSku = false;
  if (verifySku && minimums.size === 1) {
    const [sku] = minimums.keys();
    const win = windows.get(sku);
    if (!win.failed && (!win.rows.length || coverage.allZero)) {
      unknownSku = !(await getProductsBySku([sku], ['sku']))[0];
      if (unknownSku) {
        coverage.canExpand = false;
        coverage.allZero = false;
      }
    }
  }
  let expandedSearch;
  if (expandSearch && coverage.canExpand) {
    try { expandedSearch = await widerSearch(windows, minimums, origin); }
    catch { expandedSearch = { radiusKm: STOCK_RADIUS_KM, checkedStores: 0, partial: true, stores: [] }; }
    coverage.canExpand = false;
  }
  return { windows, coverage, unknownSku, ...(expandedSearch && { expandedSearch }) };
}
