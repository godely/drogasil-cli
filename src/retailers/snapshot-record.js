// A partner snapshot groups every seller of one pack. Flat offer fields must
// describe the same seller, including when a marketplace offer costs less.
export function partnerSnapshotRecord(record) {
  const offers = record.offers;
  const defaults = offers.filter(offer => offer.isDefaultSeller === true);
  const selected = offers.length === 1 ? offers[0] : defaults.length === 1 ? defaults[0] : null;
  const product = selected ?? offers[0];
  const paths = (product?.categoryPaths ?? []).map(path => path.split('/').filter(Boolean)).filter(parts => parts.length);
  const longest = paths.reduce((previous, path) => path.length > previous.length ? path : previous, []);
  return {
    ...record,
    brand: product?.brand ?? null,
    categories: [...new Set(paths.flat())],
    categoryPath: longest.length ? longest.join(' > ') : null,
    productUrl: product?.productUrl ?? null,
    currentPrice: selected?.currentPrice ?? null,
    listPrice: selected?.listPrice ?? null,
    discountPercentage: selected?.discountPercentage ?? null,
    currency: selected?.currency ?? null,
    stockSignal: selected?.onlineStockSignal ?? null,
    inStock: selected?.inStock ?? null,
    seller: selected?.seller ?? null,
    sellerId: selected?.sellerId ?? null,
    sourceUrl: product?.sourceUrl ?? null,
    scrapedAt: product?.observedAt ?? null,
    priceScope: selected?.priceScope ?? null,
  };
}
