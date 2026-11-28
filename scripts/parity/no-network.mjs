// Deterministic missing-SKU and service-error responses for executable checks.
globalThis.fetch = async (url, init) => {
  if (process.env.PARITY_FIXTURE === 'failure') return new Response('offline', { status: 503 });
  const target = new URL(url);
  if (process.env.PARITY_FIXTURE === 'directory') {
    // Farther upstream row comes first in all three native formats.
    const rows = [[2,2],[1,1]];
    if (target.hostname === 'www.drogasil.com.br' && JSON.parse(init.body).query.includes('stores(input')) {
      return Response.json({data:{stores:{items:rows.map(([id,latitude]) => ({id,storeName:'DROGASIL',fantasyName:'Centro '+id,
        labelAttendance:['Seg à sex 08:00 às 20:00'],address:{street:'Rua A',latitude,longitude:1}}))}}});
    }
    if (target.hostname === 'www.paguemenos.com.br' && target.pathname.includes('get-store-base-by-coordinates')) {
      return Response.json({sortedStores:rows.map(([id,latitude]) => ({cod_loja:id,bandeira:'PAGUE MENOS',nome_loja:'Centro '+id,
        latitude_loja:latitude,longitude:1,distancia_usuario:latitude-1,endereco:'Rua A',seg_a_sex:'08:00 AS 20:00'}))});
    }
    if (target.hostname === 'www.drogariasaopaulo.com.br' && target.pathname.endsWith('/nossas-lojas.js')) {
      return Response.json({retorno:rows.map(([id,latitude]) => ({codigo:id,nome:'DSP Centro '+id,latitude,longitude:1,
        endereco:'Rua A',horarioAberturaSegsex:'08:00',horarioFechamentoSegsex:'20:00'}))});
    }
    throw Error('Unexpected directory lookup');
  }
  if (target.pathname.endsWith('/objects')) {
    const slots = JSON.parse(init.body).requests.map(() => null);
    return Response.json({ results: slots });
  }
  if (target.pathname.endsWith('/queries')) return Response.json({results:[{hits:[],page:0,nbHits:0,nbPages:0,facets:{}}]});
  if (target.pathname.endsWith('/products/search')) return Response.json([]);
  throw new Error('Unexpected lookup during CLI parity check');
};
