import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productUrl, parseStorefront } from '../src/api/storefront.js';

test('source discount belongs to the same SKU and selling price; missing stock remains unknown', () => {
  const hit = { sku: 42, url: '/product.html', categories: [] };
  const productData = { sku: '42', name: 'Item', liveComposition: { livePrice: { valueTo: 8 } },
    price_aux: { value_from: 10 }, variant: { products: [{ sku: '10', liveComposition: { livePrice: { valueTo: 8, discountPercentage: 20 } } }] } };
  const render = () => '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { productData } } }) + '</script>';
  const snap = parseStorefront(render(), hit, 'item');
  assert.deepEqual([snap.currentPrice, snap.listPrice, snap.discountPercentage, snap.inStock], [8, 10, null, null]);
  productData.sku = '10';
  assert.throws(() => parseStorefront(render(), hit, 'item'), /SKU/);
  assert.throws(() => productUrl('https://example.org/untrusted.html'));
});
