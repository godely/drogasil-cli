import { searchProducts } from '../src/api/algolia.js';
import { readStorefront } from '../src/api/storefront.js';
import { setTimeout as pause } from 'node:timers/promises';

const rows = [];
const groups = ['paracetamol', 'protetor solar', 'shampoo', 'fralda', 'medicamento especial', 'perfume'];
for (const query of groups) {
  const { hits } = await searchProducts(query, { hitsPerPage: 30 });
  let count = 0;
  for (const hit of hits) {
    if (rows.some(row => row.sku === String(hit.sku))) continue;
    if (count++ >= 5) break;
    try {
      const { snapshot, html } = await readStorefront(hit, query);
      const rendered = html.match(/class="[^"]*\bproduct-price\b[^"]*"[^>]*>\s*R\$\s*([\d.]+,\d{2})/i);
      const visiblePrice = rendered ? Number(rendered[1].replaceAll('.', '').replace(',', '.')) : null;
      rows.push({ ...snapshot, visiblePrice, catalogReference: hit.price });
    } catch (error) {
      rows.push({ sku: String(hit.sku), query, error: error.message.split('\n')[0] });
    }
    await pause(750);
  }
}
console.log(JSON.stringify(rows, null, 2));
