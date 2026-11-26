import { searchProducts } from '../api/index.js';
import { printJson, table, formatPrice } from '../format.js';

export const usage = `Usage: drogasil search <query> [--limit N] [--page N] [--json]

Full-text product search. Prints SKU, name, brand and reference price.

Options:
  --limit N   Hits per page, 1..1000 (default 20)
  --page N    Page number, starting at 1 (default 1)
  --json      Raw Algolia result`;

export const options = {
  limit: { type: 'string', default: '20' },
  page: { type: 'string', default: '1' },
};

const MAX_HITS_PER_PAGE = 1000; // Algolia's ceiling

function usageError(message) {
  process.stderr.write(`drogasil: ${message}\n\n${usage}\n`);
  return 1;
}

export async function run(positionals, values) {
  const query = positionals.join(' ').trim();
  if (!query) return usageError('missing <query>');

  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HITS_PER_PAGE) {
    return usageError(`--limit must be an integer 1..${MAX_HITS_PER_PAGE}, got "${values.limit}"`);
  }
  const page = Number(values.page);
  if (!Number.isInteger(page) || page < 1) {
    return usageError(`--page must be an integer >= 1, got "${values.page}"`);
  }

  // Algolia pages are zero-based; the CLI is one-based like the footer below.
  const result = await searchProducts(query, { hitsPerPage: limit, page: page - 1 });

  if (values.json) {
    printJson(result);
    return 0;
  }

  if (result.hits.length === 0) {
    process.stdout.write('No products found.\n');
    return 0;
  }

  const rows = result.hits.map((h) => [h.sku, h.name, h.brand ?? '', formatPrice(h.price)]);
  process.stdout.write(table(['SKU', 'NAME', 'BRAND', 'PRICE'], rows) + '\n');
  if (result.nbPages > 1) {
    process.stdout.write(`\npage ${result.page + 1} of ${result.nbPages} (${result.nbHits} hits)\n`);
  }
  return 0;
}
