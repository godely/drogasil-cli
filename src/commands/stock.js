import {
  getNearbyStockByLatLong,
  getNearbyStockByZipCode,
  getProductsBySku,
  isNoNearbyStock,
} from '../api/index.js';
import { parseCoords } from '../geo.js';
import { printJson, table, formatKm, formatAddress, formatHours } from '../format.js';

export const usage = `Usage: drogasil stock <sku> (--lat LAT --lon LON | --cep CEP [--max-branches N]) [--min-qty N | --all] [--json]

Nearby Drogasil stores holding <sku>, nearest first.

Options:
  --lat, --lon        Search from an exact point (preferred)
  --cep CEP           Search from a postal code (fallback; origin is approximate)
  --min-qty N         Only stores with at least N units (default 1)
  --all               Include zero-stock stores (omits the quantity filter)
  --max-branches N    CEP mode only: branches to search, 3..30 (default 30)
  --json              Raw API rows`;

export const options = {
  lat: { type: 'string' },
  lon: { type: 'string' },
  cep: { type: 'string' },
  'min-qty': { type: 'string' },
  all: { type: 'boolean', default: false },
  'max-branches': { type: 'string' },
};

function usageError(message) {
  process.stderr.write(`drogasil: ${message}\n\n${usage}\n`);
  return 1;
}

export async function run(positionals, values) {
  const sku = positionals[0]?.trim();
  const hasPoint = values.lat != null || values.lon != null;
  const hasCep = values.cep != null;

  if (!sku) return usageError('missing <sku>');
  if (hasPoint && hasCep) return usageError('use either --lat/--lon or --cep, not both');
  if (!hasPoint && !hasCep) return usageError('an origin is required: --lat LAT --lon LON, or --cep CEP');
  if (hasPoint && (values.lat == null || values.lon == null)) return usageError('--lat and --lon must be given together');
  if (values.all && values['min-qty'] != null) return usageError('--all and --min-qty are mutually exclusive');
  if (hasPoint && values['max-branches'] != null) return usageError('--max-branches applies to --cep mode only');

  let quantity;
  if (!values.all) {
    quantity = Number(values['min-qty'] ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return usageError(`--min-qty must be a positive integer, got "${values['min-qty']}"`);
    }
  }

  let maxBranches = 30;
  if (values['max-branches'] != null) {
    maxBranches = Number(values['max-branches']);
    if (!Number.isInteger(maxBranches) || maxBranches < 3 || maxBranches > 30) {
      return usageError(`--max-branches must be an integer 3..30, got "${values['max-branches']}"`);
    }
  }

  let rows;
  try {
    if (hasPoint) {
      const { latitude, longitude } = parseCoords(values.lat, values.lon);
      rows = await getNearbyStockByLatLong({ sku, latitude, longitude, quantity });
    } else {
      rows = await getNearbyStockByZipCode({ sku, zipcode: values.cep, quantity, maxBranches });
    }
  } catch (err) {
    // "Filial próxima sem estoque" is an answer, not a failure.
    if (isNoNearbyStock(err)) rows = [];
    else throw err;
  }

  if (values.json) printJson(rows);

  if (rows.length === 0) {
    // The stock API gives the same "sem estoque" answer for a SKU that does
    // not exist. One Algolia lookup tells the two apart.
    const [product] = await getProductsBySku([sku], ['sku']);
    const message = product == null ? `Unknown SKU ${sku}.` : 'No nearby store has this product in stock.';
    (values.json ? process.stderr : process.stdout).write(message + '\n');
    return 3;
  }

  if (values.json) return 0;

  const out = rows.map((r) => [
    formatKm(r.branch?.distanceKMFromSearch),
    r.branch?.businessName ?? '',
    r.stocks?.[0]?.quantity ?? '',
    formatHours(r.branch?.branchService),
    r.branch?.branchService?.isOpen ? 'open' : 'closed',
    formatAddress(r.branch?.address),
  ]);
  process.stdout.write(table(['DIST', 'STORE', 'QTY', 'HOURS', 'NOW', 'ADDRESS'], out) + '\n');
  return 0;
}
