import { searchProducts } from 'drogasil-cli';
import { samePack, validBarcode } from '../../src/api/retail-prices.js';
import { retailer } from 'paguemenos-cli';
import { setTimeout as pause } from 'node:timers/promises';
const origins = process.argv.slice(2);
if (origins.length !== 2 || origins.some(c=>!/^\d{5}-?\d{3}$/.test(c))) throw new Error('Supply two test CEPs');
const queries = ['paracetamol','loratadina','ibuprofeno','dipirona','omeprazol','cetirizina','simeticona','vitamina c'];
const seen = new Set(), verified = [];
let rejected = 0;
search: for (const q of queries) {
  for (const p of (await searchProducts(q,{hitsPerPage:25})).hits) {
    const gtin = String(p.eanCode ?? '');
    if (!validBarcode(gtin) || seen.has(gtin)) continue;
    seen.add(gtin);
    await pause(250);
    const rows = await retailer.byGtin(gtin);
    const offer = rows.find(row => samePack({name:p.name,gtin},row));
    if (!offer) { rejected++; continue; }
    const locations = [];
    for (const postal of origins) {
      const local = await retailer.local(offer,postal);
      locations.push({ status:local.localStatus,methods:local.methods.length,price:local.currentPrice });
    }
    verified.push({ gtin,drogasilSku:String(p.sku),retailerSku:offer.sku,locations });
    if (verified.length === 25) break search;
  }
}
console.log(JSON.stringify({ checked:seen.size,rejected,verified },null,2));
if (verified.length < 25) process.exitCode = 3;
