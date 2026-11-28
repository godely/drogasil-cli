const knownSkus = new Set(['101', '202']);
globalThis.fetch = async (url, init) => {
  if (process.env.PARITY_FIXTURE === 'failure') return new Response('offline', { status: 503 });
  const target = new URL(url);
  if (target.pathname.endsWith('/objects')) {
    const slots = JSON.parse(init.body).requests.map(({ objectID }) =>
      knownSkus.has(objectID) ? { sku: objectID, name: `Product ${objectID}` } : null);
    return Response.json({ results: slots });
  }
  if (target.pathname.endsWith('/queries')) return Response.json({results:[{hits:[],page:0,nbHits:0,nbPages:0,facets:{}}]});
  if (target.pathname.endsWith('/products/search')) {
    const sku = target.searchParams.get('fq')?.match(/^skuId:(\d+)$/)?.[1];
    return Response.json(knownSkus.has(sku)
      ? [{ items: [{ itemId: sku, name: 'Product ' + sku, sellers: [{ sellerId: '1' }] }] }]
      : []);
  }
  throw new Error('Unexpected lookup during CLI parity check');
};
