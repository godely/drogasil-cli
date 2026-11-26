// Product search and lookup: Algolia index behind a Topsort ad worker.

import { postJson } from './http.js';

const BASE = 'https://drogasil-prod.topsort.workers.dev/1/indexes/*';
export const INDEX_NAME = 'drogasil-rd-product-index';

// Public search-only key exposed to the browser. Can be rotated without notice.
const ALGOLIA_HEADERS = {
  'x-algolia-api-key': process.env.DROGASIL_ALGOLIA_KEY ?? '2136627307d7d5384f92cda9f7e5357c',
  'x-algolia-application-id': process.env.DROGASIL_ALGOLIA_APP ?? 'A7RGTHYMDQ',
};

/**
 * Full-text product search. Returns raw Algolia hits.
 * @param {string} query
 * @param {{ hitsPerPage?: number, page?: number, filters?: string }} [opts]
 * @returns {Promise<{ hits: any[], nbHits: number, page: number, nbPages: number }>}
 */
export async function searchProducts(query, opts = {}) {
  const request = {
    indexName: INDEX_NAME,
    query,
    hitsPerPage: String(opts.hitsPerPage ?? 20),
  };
  if (opts.page != null) request.page = opts.page;
  if (opts.filters) request.filters = opts.filters;

  const json = await postJson(
    `${BASE}/queries?category=web_search_sponsored_products`,
    { requests: [request] },
    ALGOLIA_HEADERS,
  );
  const result = json?.results?.[0] ?? {};
  return {
    hits: result.hits ?? [],
    nbHits: result.nbHits ?? 0,
    page: result.page ?? 0,
    nbPages: result.nbPages ?? 0,
  };
}

/**
 * Direct key lookup by SKU. Unknown SKUs come back as null in their slot.
 * @param {string[]} skus
 * @param {string[]} [attributes] attributesToRetrieve; omit for the full record
 * @returns {Promise<Array<any|null>>}
 */
export async function getProductsBySku(skus, attributes) {
  const requests = skus.map((sku) => {
    const r = { indexName: INDEX_NAME, objectID: String(sku) };
    if (attributes) r.attributesToRetrieve = attributes;
    return r;
  });
  const json = await postJson(`${BASE}/objects`, { requests }, ALGOLIA_HEADERS);
  return json?.results ?? [];
}
