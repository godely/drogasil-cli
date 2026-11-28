import { searchStockWindows, stockQuantity } from '../api/index.js';
import { acceptExpansion, describeRange } from './stock-range.js';
import { parseCoords } from '../geo.js';
import { optionError, printJson, table, formatKm, formatAddress, formatHours } from '../format.js';

export const usage = `Usage: drogasil stock <sku> (--lat LAT --lon LON | --cep CEP [--max-branches N]) [--min-qty N | --all] [--expand] [--json]

Nearby Drogasil stores holding <sku>, nearest first.

Options:
  --lat, --lon        Search from an exact point (preferred)
  --cep CEP           Search from a postal code (fallback; origin is approximate)
  --min-qty N         Only stores with at least N units (default 1)
  --all               Include zero-stock stores (omits the quantity filter)
  --max-branches N    CEP mode only: branches to search, 3..30 (default 30)
  --expand            After zero nearby stock, search up to 25 km and show up to 10 stocked stores
  --json              Raw API rows`;

export const options = {
  lat: { type: 'string' },
  lon: { type: 'string' },
  cep: { type: 'string' },
  'min-qty': { type: 'string' },
  expand: { type: 'boolean' },
  all: { type: 'boolean', default: false },
  'max-branches': { type: 'string' },
};

export async function run(positionals, values) {
  const usageError = message => optionError(message, values.json, `drogasil: ${message}\n\n${usage}`);
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

  const origin = hasPoint ? parseCoords(values.lat, values.lon) : { zipcode: values.cep };
  const output = values.json ? process.stderr : process.stdout;
  // A filtered upstream request can return a different set of branches. Read the
  // complete initial window so --max-branches, the quantities and the reach agree.
  const search = expandSearch => searchStockWindows(new Map([[sku, quantity ?? 1]]), origin,
    { maxBranches, expandSearch, verifySku: true });
  let result = await search(Boolean(values.expand));
  output.write(describeRange(result));
  if (await acceptExpansion(result.coverage, !values.json)) {
    result = await search(true);
    output.write(describeRange(result));
  }
  const window = result.windows.get(sku).rows;
  let rows = values.all ? window : window.filter(row => stockQuantity(row, sku) >= quantity);
  if (result.expandedSearch && !values.all) rows = rows.slice(0, result.expandedSearch.stores.length);
  if (result.unknownSku) rows = [];
  if (values.json) printJson(rows);
  if (result.unknownSku) {
    output.write('Unknown SKU ' + sku + '.\n');
    return 3;
  }
  if (!rows.length) {
    let message = 'No nearby store has this product in stock.';
    if (result.expandedSearch || result.coverage.stockUnknown) message = 'No qualifying stock confirmed among the stores checked.';
    else if (quantity > 1) message = 'No nearby store reported enough units.';
    output.write(message + '\n');
    return result.expandedSearch?.partial || result.coverage.stockUnknown ? 2 : 3;
  }
  if (result.expandedSearch && !values.all) return 0;
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
