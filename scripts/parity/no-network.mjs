// Deterministic missing-SKU and service-error responses for executable checks.
globalThis.fetch = async (url, init) => {
  if (process.env.PARITY_FIXTURE === 'failure') return new Response('offline', { status: 503 });
  const target = new URL(url);
  if (target.pathname.endsWith('/objects')) {
    const slots = JSON.parse(init.body).requests.map(() => null);
    return Response.json({ results: slots });
  }
  if (target.pathname.endsWith('/products/search')) return Response.json([]);
  throw new Error('Unexpected lookup during CLI parity check');
};
