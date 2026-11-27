import { compareRetailPrices } from 'drogasil-cli';
import { retailers } from '../retailers.js';
const [query, zipcode] = process.argv.slice(2);
if (!query || !zipcode) throw new Error('Usage: node mcp/scripts/compare-prices.mjs <query|SKU|GTIN> <CEP>');
console.log(JSON.stringify(await compareRetailPrices(query,{ zipcode, retailers }), null, 2));
