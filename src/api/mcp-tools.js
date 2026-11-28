import { searchBrandPage } from '../retailers/presentation-search.js';
import { compareRetailPrices, collectSnapshot, readSnapshot, compareProducts, medicationSearch, getProductsBySku, searchStockWindows, stockQuantity, planPurchase, getMedicationInfo, productInfo } from './index.js';

const productNames = 'Accept a supplied SKU silently. Never ask for, mention, or display a SKU, its value, or a barcode in any user-facing reply, including errors and follow-ups. Identify products by name and presentation. Offer numbered choices when clarification is needed.';
const shoppingRoute = 'For purchase or stock requests naming a commercial brand, ask once which named brands may include generics and wait for the reply before using any Drogasil tool. An explicit preference or exact SKU settles only its own item. For stock or purchase planning, send every item to plan_purchase together once preferences are settled.';
const radiusRoute = 'If coverage.canExpand, report checkedStores and radiusKm (straight line) and ask whether to expand to 25 km. Wait for consent, then repeat the same request with expandSearch=true. Show expandedSearch.stores in distance order, quantities, address and any branch phone. Recommend calling before travelling. Report partial coverage and stop at 25 km. ';
const factsRoute = 'For questions about medication forms, strengths, routes, packs or prescriptions, use only get_medication_info with all names or exact SKUs in one call.';

export const shoppingInstructions = [productNames, shoppingRoute, radiusRoute, factsRoute].join(' ');

function storeInfo(branch, quantity) {
  return { id: branch.id, name: branch.businessName, distanceKm: branch.distanceKMFromSearch,
    quantity, address: branch.address, ...(branch.phone && { phone: branch.phone }), isOpen: branch.branchService?.isOpen };
}

export function registerDrogasilTools(server, z, retailers) {
  const sku = z.string().regex(/^\d+$/);
  const query = z.string().trim().min(1);
  const origin = z.union([
    z.strictObject({ zipcode: z.string().regex(/^\d{5}-?\d{3}$/) }),
    z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  ]).describe('CEP or exact coordinates explicitly supplied for this lookup.');
  const expandSearch = z.boolean().optional().describe('Set true only after the user accepts the offered 25 km search.');
  function tool(name, description, inputSchema, handler) {
    server.registerTool(name, { description: description + ' ' + productNames, inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }, async args => {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    });
  }
  tool('get_medication_info', 'One call answers all factual questions in the request. Pass each medication once, using the bare SKU when supplied. A request mentioning drops is covered by the brand lookup. Answer directly from these sources without a follow-up catalog search. Use for factual questions about medication ingredients, strength, form, route, release, pack and prescription in Brazil. No origin, stock, prices or generic preference. Use scope=brazil for which presentations exist in Brazil and catalog for what Drogasil lists. Cite each product or verified source. Null means não confirmado. Brazil records have partial coverage. Keep required, retained, and form independent.',
    { queries: z.array(query).min(1), scope: z.enum(['catalog', 'brazil']).default('catalog') },
    ({ queries, scope }) => getMedicationInfo(queries, { scope }));
  tool('plan_purchase', radiusRoute + shoppingRoute + ' Handle single- and multi-item stock requests including a mix of brands, ingredients and exact SKUs. “Opções” alone still needs a question. After the answer use one call with the shared origin. Send includeGenerics true or false on each named brand, unless the user requests generics alone or selects an exact SKU. The brand field may also name the brand being compared. Ingredients need no preference. Send all medications together. Returns one numbered table per medication (nearest stocked branch per SKU), two purchase plans when possible, and their tradeoff. Use store="nearest" only for a fixed closest branch. Honor explicit preferences. For A2/B1 replies send the SKU from the previous table as selectedSku. Show Tipo, stock, reference price and straight-line distances. Report unavailable, unknown, failed and incomplete results separately.',
    { origin, expandSearch, store: z.literal('nearest').optional(), items: z.array(z.object({
      query, quantity: z.number().int().positive().optional(), selectedSku: sku.optional(),
      includeGenerics: z.boolean().optional(), brand: z.string().trim().min(1).optional(), genericOnly: z.boolean().optional(),
    })).min(1) }, ({ items, origin, store, expandSearch }) => planPurchase(items, { origin, store, expandSearch, confirmBrands: true }));
  tool('search_products', 'Literal catalog search when the user asks for product listings or SKU discovery. Returns reference prices. ' + factsRoute + ' ' + shoppingRoute,
    { query, page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) },
    async ({ query, page, limit }) => {
      const options={page:page-1,hitsPerPage:limit};
      const result = await searchBrandPage(query,options) ?? await medicationSearch(query,options);
      const { status, interpretation, ingredientCandidates, nameCandidates, hint } = result;
      return { status, interpretation, ingredientCandidates, nameCandidates, hint, page, pages: result.nbPages, products: result.hits.map(productInfo) };
    });
  tool('get_products', 'Retrieve catalog records and reference prices for an explicit product-record lookup by SKU. Missing entries are null. For a SKU in a shopping basket send it as selectedSku in the basket call. ' + factsRoute + ' ' + shoppingRoute,
    { skus: z.array(sku).min(1).max(100) }, async ({ skus }) => ({
      products: (await getProductsBySku(skus)).map(product => product && productInfo(product)),
    }));
  tool('find_nearby_stock', radiusRoute + 'Check one SKU. For the physically closest participating branch, use store="nearest" and read nearestStore, including zero or unknown quantity. Without store, stores lists branches meeting minimumQuantity. Use this single-SKU tool for an explicit list of branches stocking that SKU. ' + shoppingRoute,
    { sku, origin, expandSearch, store: z.literal('nearest').optional(), minimumQuantity: z.number().int().min(1).default(1) }, async ({ sku, origin, store, minimumQuantity, expandSearch }) => {
      const { windows, coverage, expandedSearch, unknownSku } = await searchStockWindows(new Map([[sku, minimumQuantity]]), origin,
        { expandSearch, allowExpansion: !store, verifySku: !store });
      const window = windows.get(sku).rows.map(row => storeInfo(row.branch, stockQuantity(row, sku)));
      const nearestStore = window[0] ?? null;
      const stores = store === 'nearest' ? window.slice(0, 1) : window.filter(row => row.quantity >= minimumQuantity);
      return { sku, nearestStore, stores: expandedSearch ? stores.slice(0, expandedSearch.stores.length) : stores, coverage, unknownSku, ...(expandedSearch && { expandedSearch }), scope: store ?? 'meeting_minimum_quantity', minimumQuantity,
        hint: 'For a closest-store question report nearestStore, including quantity 0 or null (unknown). A different branch in stores is an alternative.',
        checkedAt: new Date().toISOString() };
    });
  tool('compare_products', radiusRoute + shoppingRoute + ' ' + factsRoute + ' Use this tool for an explicit price-only or equivalence comparison. For brand pricing, settle the generic preference first. Send the original spelling, strength, release and pack. For the closest participating branch, include origin and store="nearest" in one call. Report incomplete_presentation directly: these are direct catalog hits with unverified equivalence, and their branch quantities answer the stock question. Ask the user only for genuine ambiguity or conflicting specifications. Confirm before changing a requested strength or release.',
    { query, expandSearch, includeGenerics: z.boolean().optional(), origin: origin.optional(), store: z.union([z.literal('nearest'), sku]).optional() }, async ({ query, origin, store, includeGenerics, expandSearch }) => {
      const result = await compareProducts(query, { origin, store, includeGenerics, expandSearch, resolveNames: true });
      if (result.status === 'ambiguous') return { ...result, candidates: result.candidates?.map(productInfo) };
      if (result.groups) return { ...result, groups: result.groups.map(group => group.map(productInfo)) };
      return { ...result, checkedAt: new Date().toISOString(), products: result.products.map(product => ({
        ...productInfo(product), storeId: product.storeId, stockStatus: product.stockStatus, stores: product.stores?.map(store => storeInfo(store, store.quantity)),
      })) };
    });
  tool('compare_pharmacy_prices', 'Compare the same exact pack across participating retailers. Supply a name, Drogasil SKU or GTIN and a user-supplied CEP. Rank only verified local offers. Online-only prices and optional matching generics are separate.',
    { query, zipcode: z.string().regex(/^\d{5}-?\d{3}$/), includeGenerics: z.boolean().default(false) },
    ({ query, zipcode, includeGenerics }) => compareRetailPrices(query, { zipcode, retailers, includeGenerics }));
  server.registerTool('collect_catalog_snapshot', {
    description: productNames + ' Start an explicitly requested bulk storefront collection. This saves an anonymous catalog dataset. Poll the same run ID with read_catalog_snapshot.',
    inputSchema: { queries: z.array(z.string().trim().min(1).max(150)).min(1).max(10), maxItems: z.number().int().min(1).max(1000).default(20) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({ queries, maxItems }) => {
    const result = await collectSnapshot(queries, { background: true, maxItems });
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  });
  tool('read_catalog_snapshot', 'Read a bounded page of an existing catalog run. Show failed or running results as partial. Use nextOffset for continuation.',
    { runId: z.string().uuid(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) },
    ({ runId, offset, limit }) => readSnapshot(runId, { offset, limit }));
  return server;
}
