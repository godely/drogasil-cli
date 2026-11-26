import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { compareProducts, medicationSearch, getProductsBySku, getNearbyStockByZipCode,
  getNearbyStockByLatLong, isNoNearbyStock, VERSION } from 'drogasil-cli';

const sku = z.string().regex(/^\d+$/);
const query = z.string().trim().min(1);
const origin = z.union([
  z.strictObject({ zipcode: z.string().regex(/^\d{5}-?\d{3}$/) }),
  z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
]).describe('CEP or exact coordinates explicitly supplied for this lookup.');

function productInfo(product) {
  return { sku: String(product.sku), name: product.name, brand: product.brand,
    referencePriceBRL: product.price, pack: product.details?.quantidade };
}

function storeInfo(branch, quantity) {
  return { id: branch.id, name: branch.businessName, distanceKm: branch.distanceKMFromSearch,
    quantity, address: branch.address, isOpen: branch.branchService?.isOpen };
}

export function createServer() {
  const server = new McpServer({ name: 'drogasil', version: VERSION });
  function tool(name, description, inputSchema, handler) {
    server.registerTool(name, { description, inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }, async args => {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    });
  }
  tool('search_products', 'Literal catalog lookup with medication spelling and language normalization. Brand searches stay within the brand. For all matching generics and brands, use compare_products.',
    { query, page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) },
    async ({ query, page, limit }) => {
      const result = await medicationSearch(query, { page: page - 1, hitsPerPage: limit });
      const { status, interpretation, ingredientCandidates, nameCandidates, hint } = result;
      return { status, interpretation, ingredientCandidates, nameCandidates, hint, page, pages: result.nbPages, products: result.hits.map(productInfo) };
    });
  tool('get_products', 'Look up catalog presentations by SKU, preserving request order. Missing entries are null.',
    { skus: z.array(sku).min(1).max(100) }, async ({ skus }) => ({
      products: (await getProductsBySku(skus)).map(product => product && productInfo(product)),
    }));
  tool('find_nearby_stock', 'Find store options for one specific SKU, nearest first. For medication options (matching brands and generics), use compare_products with the shared location.',
    { sku, origin, minimumQuantity: z.number().int().min(1).default(1) }, async ({ sku, origin, minimumQuantity }) => {
      const params = { ...origin, sku, quantity: minimumQuantity };
      let rows;
      try {
        rows = origin.zipcode ? await getNearbyStockByZipCode(params) : await getNearbyStockByLatLong(params);
      } catch (err) {
        if (!isNoNearbyStock(err)) throw err;
        rows = [];
      }
      const stores = [];
      for (const { branch, stocks } of rows) {
        const stock = stocks.find(item => String(item.sku) === sku);
        if (stock?.quantity >= minimumQuantity) stores.push(storeInfo(branch, stock.quantity));
      }
      return { sku, stores, checkedAt: new Date().toISOString() };
    });
  tool('compare_products', 'Find medication options including matching brands and generics, cheapest reference price first. Use for “Frontal 2mg options in my area” with the original query and shared coordinates. Expand a brand to matching ingredient(s), strength, form, release and pack. Set store to nearest or a store ID with origin to see every equivalent at one branch, including zeros. For presentation_options, display separate groups; for ambiguous names ask which candidate was intended. With a location, include stocked branches. If ambiguous, ask the user to choose a candidate SKU.',
    { query, origin: origin.optional(), store: z.union([z.literal('nearest'), sku]).optional() }, async ({ query, origin, store }) => {
      const result = await compareProducts(query, { origin, store, resolveNames: true });
      if (result.status === 'ambiguous') return { ...result, candidates: result.candidates?.map(productInfo) };
      if (result.groups) return { ...result, groups: result.groups.map(group => group.map(productInfo)) };
      return { ...result, checkedAt: new Date().toISOString(), products: result.products.map(product => ({
        ...productInfo(product), storeId: product.storeId, stockStatus: product.stockStatus, stores: product.stores?.map(store => storeInfo(store, store.quantity)),
      })) };
    });
  return server;
}
