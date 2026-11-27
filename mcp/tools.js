import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compareProducts, medicationSearch, getProductsBySku, getNearbyStockByZipCode,
  getNearbyStockByLatLong, isNoNearbyStock, planPurchase, getMedicationInfo, productInfo, VERSION } from 'drogasil-cli';

const sku = z.string().regex(/^\d+$/);
const query = z.string().trim().min(1);
const origin = z.union([
  z.strictObject({ zipcode: z.string().regex(/^\d{5}-?\d{3}$/) }),
  z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
]).describe('CEP or exact coordinates explicitly supplied for this lookup.');

function storeInfo(branch, quantity) {
  return { id: branch.id, name: branch.businessName, distanceKm: branch.distanceKMFromSearch,
    quantity, address: branch.address, isOpen: branch.branchService?.isOpen };
}

const shoppingRoute = 'For purchase or stock requests naming a commercial brand, ask once which named brands may include generics and wait for the reply before using any Drogasil tool. An explicit preference or exact SKU settles only its own item. For stock or purchase planning, send every item to plan_purchase together once preferences are settled.';
const factsRoute = 'For questions about medication forms, strengths, routes, packs or prescriptions, use only get_medication_info with all names or exact SKUs in one call.';

export function createServer() {
  const server = new McpServer({ name: 'drogasil', version: VERSION }, {
    instructions: `${shoppingRoute} ${factsRoute}`,
  });
  function tool(name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }, async args => {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    });
  }
  tool('get_medication_info', 'One call answers all factual questions in the request. Pass each medication once, using the bare SKU when supplied. A request mentioning drops is covered by the brand lookup. Answer directly from these sources without a follow-up catalog search. Use for factual questions about medication ingredients, strength, form, route, release, pack and prescription in Brazil. No origin, stock, prices or generic preference. Use scope=brazil for which presentations exist in Brazil and catalog for what Drogasil lists. Cite each product or verified source. Null means não confirmado. Brazil records have partial coverage. Keep required, retained, and form independent.',
    { queries: z.array(query).min(1), scope: z.enum(['catalog', 'brazil']).default('catalog') },
    ({ queries, scope }) => getMedicationInfo(queries, { scope }));
  tool('plan_purchase', shoppingRoute + ' Handle single- and multi-item stock requests including a mix of brands, ingredients and exact SKUs. “Opções” alone still needs a question. After the answer use one call with the shared origin. Send includeGenerics true or false on each named brand, unless the user requests generics alone or selects an exact SKU. The brand field may also name the brand being compared. Ingredients need no preference. Send all medications together. Returns one numbered table per medication (nearest stocked branch per SKU), two purchase plans when possible, and their tradeoff. Use store="nearest" only for a fixed closest branch. Honor explicit preferences. For A2/B1 replies send the SKU from the previous table as selectedSku. Show Tipo, stock, reference price and straight-line distances. Report unavailable, unknown, failed and incomplete results separately.',
    { origin, store: z.literal('nearest').optional(), items: z.array(z.object({
      query, quantity: z.number().int().positive().optional(), selectedSku: sku.optional(),
      includeGenerics: z.boolean().optional(), brand: z.string().trim().min(1).optional(), genericOnly: z.boolean().optional(),
    })).min(1) }, ({ items, origin, store }) => planPurchase(items, { origin, store, confirmBrands: true }));
  tool('search_products', 'Literal catalog search when the user asks for product listings or SKU discovery. Returns reference prices. ' + factsRoute + ' ' + shoppingRoute,
    { query, page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) },
    async ({ query, page, limit }) => {
      const result = await medicationSearch(query, { page: page - 1, hitsPerPage: limit });
      const { status, interpretation, ingredientCandidates, nameCandidates, hint } = result;
      return { status, interpretation, ingredientCandidates, nameCandidates, hint, page, pages: result.nbPages, products: result.hits.map(productInfo) };
    });
  tool('get_products', 'Retrieve catalog records and reference prices for an explicit product-record lookup by SKU. Missing entries are null. For a SKU in a shopping basket send it as selectedSku in the basket call. ' + factsRoute + ' ' + shoppingRoute,
    { skus: z.array(sku).min(1).max(100) }, async ({ skus }) => ({
      products: (await getProductsBySku(skus)).map(product => product && productInfo(product)),
    }));
  tool('find_nearby_stock', 'Check one SKU. For the physically closest participating branch, use store="nearest" and read nearestStore, including zero or unknown quantity. Without store, stores lists branches meeting minimumQuantity. Use this single-SKU tool for an explicit list of branches stocking that SKU. ' + shoppingRoute,
    { sku, origin, store: z.literal('nearest').optional(), minimumQuantity: z.number().int().min(1).default(1) }, async ({ sku, origin, store, minimumQuantity }) => {
      const params = { ...origin, sku };
      let rows;
      try {
        rows = origin.zipcode ? await getNearbyStockByZipCode(params) : await getNearbyStockByLatLong(params);
      } catch (err) {
        if (!isNoNearbyStock(err)) throw err;
        rows = [];
      }
      const window = rows.map(({ branch, stocks }) =>
        storeInfo(branch, stocks?.find(item => String(item.sku) === sku)?.quantity ?? null));
      const nearestStore = window[0] ?? null;
      const stores = store === 'nearest' ? window.slice(0, 1) : window.filter(row => row.quantity >= minimumQuantity);
      return { sku, nearestStore, stores, scope: store ?? 'meeting_minimum_quantity', minimumQuantity,
        hint: 'For a closest-store question report nearestStore, including quantity 0 or null (unknown). A different branch in stores is an alternative.',
        checkedAt: new Date().toISOString() };
    });
  tool('compare_products', shoppingRoute + ' ' + factsRoute + ' Use this tool for an explicit price-only or equivalence comparison. For brand pricing, settle the generic preference first. Send the original spelling, strength, release and pack. For the closest participating branch, include origin and store="nearest" in one call. Report incomplete_presentation directly: these are direct catalog hits with unverified equivalence, and their branch quantities answer the stock question. Ask the user only for genuine ambiguity or conflicting specifications. Confirm before changing a requested strength or release.',
    { query, includeGenerics: z.boolean().optional(), origin: origin.optional(), store: z.union([z.literal('nearest'), sku]).optional() }, async ({ query, origin, store, includeGenerics }) => {
      const result = await compareProducts(query, { origin, store, includeGenerics, resolveNames: true });
      if (result.status === 'ambiguous') return { ...result, candidates: result.candidates?.map(productInfo) };
      if (result.groups) return { ...result, groups: result.groups.map(group => group.map(productInfo)) };
      return { ...result, checkedAt: new Date().toISOString(), products: result.products.map(product => ({
        ...productInfo(product), storeId: product.storeId, stockStatus: product.stockStatus, stores: product.stores?.map(store => storeInfo(store, store.quantity)),
      })) };
    });
  return server;
}
