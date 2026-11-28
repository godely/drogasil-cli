// Anonymous product pages expose the rendered offer and the structured data used to render it.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError, NetworkError } from './http.js';

const exec = promisify(execFile);
const site = 'https://www.drogasil.com.br';
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function productUrl(value) {
  const url = new URL(value, site);
  if (url.origin !== site || url.username || url.password || !/^\/[\w%.-]+\.html$/i.test(url.pathname)) {
    throw new Error('Invalid Drogasil product URL');
  }
  return site + url.pathname;
}

export function parseStorefront(html, hit, query, at = new Date()) {
  const script = html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Storefront product data unavailable');
  const page = JSON.parse(script[1]).props?.pageProps;
  const product = page?.productData;
  if (!product?.liveComposition || String(product.sku) !== String(hit.sku)) {
    throw new Error('Storefront product or offer does not match the requested SKU');
  }
  const { livePrice, liveStock } = product.liveComposition;
  if (!livePrice && !liveStock) throw new Error('Missing storefront offer');
  const structured = page.pdpSeoSchemaResult?.nodes;
  const nodes = Array.isArray(structured) ? structured : [];
  const schema = nodes.find(n => n?.['@type'] === 'Product' && String(n.sku) === String(hit.sku));
  const currentPrice = number(livePrice?.valueTo) ?? number(product.price_aux?.value_to);
  const variant = product.variant?.products?.find(v => String(v.sku) === String(hit.sku));
  const same = currentPrice != null && variant?.liveComposition?.livePrice?.valueTo === currentPrice;
  const stockSignal = number(liveStock?.qty);
  const paths = Object.values(hit.hierarchicalCategories ?? {}).flat().filter(v => typeof v === 'string');
  const seller = html.match(/data-testid="sold-and-delivered-by"[^>]*>\s*<p>[^<]*<span>([^<]+)<\/span>/i)?.[1];
  return { sku: String(hit.sku), name: product.name, brand: hit.brand ?? null,
    categories: (hit.categories ?? []).map(c => c.name).filter(Boolean), categoryPath: paths.at(-1) ?? null,
    productUrl: productUrl(hit.url), currentPrice, listPrice: number(product.price_aux?.value_from),
    discountPercentage: number(livePrice?.discountPercentage) ?? (same ? number(variant.liveComposition.livePrice.discountPercentage) : null),
    currency: schema?.offers?.priceCurrency ?? 'BRL', stockSignal, inStock: stockSignal == null ? null : stockSignal > 0,
    seller: seller ?? schema?.offers?.seller?.name ?? null, searchQuery: query,
    sourceUrl: site + '/search?w=' + encodeURIComponent(query), scrapedAt: at.toISOString() };
}

export async function fetchStorefrontPage(url, onResponseBytes) {
  // Under Linux, curl cannot reopen Node's child-process stderr socket as a file.
  const directory = await mkdtemp(join(tmpdir(), 'drogasil-offer-'));
  const headersPath = join(directory, 'headers');
  try {
    const {stdout} = await exec('curl', ['--silent', '--show-error', '--compressed', '--max-time', '20', '--max-filesize', '8000000',
      '--dump-header', headersPath, '--write-out', '\n%{http_code} %{size_download}', '--', url], {maxBuffer:8_500_000,encoding:'buffer'});
    const end = stdout.lastIndexOf(10);
    const [status, transferBytes] = stdout.subarray(end + 1).toString('ascii').split(' ').map(Number);
    const body = stdout.subarray(0, end);
    if (body.length > 8_000_000) throw new Error('Storefront response exceeds the decoded size limit');
    onResponseBytes?.(body.length, transferBytes);
    if (status < 200 || status >= 300 || !Number.isInteger(status)) {
      const error = new HttpError(status, url, null, 'Product page returned HTTP ' + status);
      const headers = await readFile(headersPath, 'utf8');
      const finalHeaders = headers.trimEnd().split(/\r?\n\r?\n/).filter(block => /^HTTP\//i.test(block)).at(-1);
      error.retryAfter = finalHeaders?.match(/^retry-after:[ \t]*([^\r\n]+)/im)?.[1];
      throw error;
    }
    return body.toString('utf8');
  } catch (error) {
    if ([5, 6, 7, 18, 28, 52, 55, 56].includes(error.code))
      throw new NetworkError(url, new Error('curl transport error ' + error.code), 20000);
    // A curl error can include response headers or a partial page.
    if (error.cmd) throw new Error('Product page download failed (' + error.code + ')');
    throw error;
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
}

export async function readStorefront(hit, query, onResponseBytes) {
  const html = await fetchStorefrontPage(productUrl(hit.url), onResponseBytes);
  return {snapshot:parseStorefront(html, hit, query), html};
}
