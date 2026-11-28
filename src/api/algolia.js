// Product search and lookup: Algolia index behind a Topsort ad worker.

import { HttpError, postJson } from './http.js';

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
  if (opts.attributes) request.attributesToRetrieve = opts.attributes;
  if (opts.page != null) request.page = opts.page;
  if (opts.filters) request.filters = opts.filters;

  return runQuery(request, opts.onResponseBytes);
}

async function runQuery(request, onResponseBytes) {
  const json = await postJson(
    `${BASE}/queries?category=web_search_sponsored_products`,
    { requests: [request] },
    ALGOLIA_HEADERS, onResponseBytes,
  );
  const result = json?.results?.[0];
  if (!result || (!request.facets && !Array.isArray(result.hits) && !result.error && !result.message)) throw new Error('Unexpected catalog search response');
  if (result.error || result.message) throw new Error(result.error ?? result.message);
  return {
    ...(request.facets ? { facets: result.facets, stats: result.facets_stats } : {}),
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
  if (!Array.isArray(json?.results) || json.results.length !== requests.length ||
      json.results.some(hit => hit !== null && (!hit || typeof hit !== 'object' || Array.isArray(hit) || hit.error || hit.message)))
    throw new HttpError(200, BASE + '/objects', null, 'Unexpected catalog object lookup response');
  return json.results;
}

const nameFacets = ['details.activeIngredients.description', 'filters.Marca'];

// Split saturated facet windows by numeric SKU so rare names remain discoverable.
export async function medicationFacets() {
  const names = nameFacets.map(() => new Set());
  async function collect(range) {
    const result = await runQuery({ indexName: INDEX_NAME, query: '', hitsPerPage: '0',
      filters: ['categories.id=532', ...range].join(' AND '),
      facets: [...nameFacets, 'sku'], maxValuesPerFacet: 1000 });
    let saturated = false;
    for (const [index, field] of nameFacets.entries()) {
      const values = Object.keys(result.facets?.[field] ?? {});
      for (const value of values) names[index].add(value);
      saturated ||= values.length >= 1000;
    }
    if (saturated) {
      const { min, max } = result.stats?.sku ?? {};
      if (!(min < max)) throw new Error('Cannot enumerate medication name facets');
      const mid = Math.floor((min + max) / 2);
      await collect([`sku>=${min}`, `sku<=${mid}`]);
      await collect([`sku>${mid}`, `sku<=${max}`]);
    }
  }
  await collect([]);
  return names.map(values => [...values]);
}
