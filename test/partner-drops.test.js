import test from 'node:test';
import assert from 'node:assert/strict';
import {retailerComparison} from '../src/retailers/shopping.js';

const code='7896676405651';
const hit={sku:1,brand:'Marca',name:'Marca 10mg/ml Solução Oral 60ml',eanCode:code,details:{quantidade:'60ml'}};
const title='Marca 10mg 60ml Solução';
const row={sku:'10',name:title,itemName:title,gtin:code,sellerId:'1',facts:{'Forma de Administração':['Via Oral']}};
const query={retailer:'rede',query:'Marca em gotas',includeGenerics:false};
const reference={drops:async (_query,generics)=>{
  assert.equal(generics,false);
  return {status:'matches',requestedBrandSkus:['1'],products:[hit]};
}};
const lookup=rows=>retailerComparison(query,{byGtin:async gtin=>{assert.equal(gtin,code);return rows;},search:async()=>[]},reference);

test('branded drops reach the retailer’s own oral solution when its strength omits /mL',async()=>{
  const r=await lookup([row]);
  assert.equal(r.status,'matches');
  assert.deepEqual(r.products.map(p=>[p.sku,p.role,p.requestedTradeName]),[['10','requested','Marca']]);
});
test('wrong pack, concentration, route, bundle, tablet or identity cannot supply the drops',async()=>{
  for(const change of [{gtin:'7896676406177'},{name:'Marca 10mg 20ml Solução'},
    {itemName:'Marca 10mg/5ml Solução 60ml'},{name:'Marca 30mg Solução 60ml'},
    {facts:{'Forma de Administração':['Via Nasal']}},{name:'Marca 10mg solução injetável 60ml'},
    {name:'Marca 10mg comprimidos 60ml'},{name:'Kit Marca 10mg solução 60ml'},
    {itemName:'Outro 10mg gel 60ml',name:'Outro 10mg solução 60ml'}]) {
    const r=await lookup([{...row,...change}]);
    assert.equal(r.products.length,0,JSON.stringify(change));
  }
});

test('GTS selects the documented drops even if the partner omits that brand qualifier',async()=>{
  const title='Marca GTS 10mg/ml Solução Gotas 60ml';
  const args={...query,query:'Marca GTS'};
  const source={byGtin:async()=>[row],search:async()=>[]};
  const lookup=label=>retailerComparison(args,source,{drops:async q=>{
    assert.equal(q,args.query);
    return {status:'matches',requestedBrandSkus:['1'],products:[{...hit,name:label}]};
  }});
  const product=(await lookup(title)).products[0];
  assert.equal(product.requestedReferenceTitle,title);
  assert.equal(product.sku,row.sku);
  assert.deepEqual((await lookup('Marca GTS 10mg/ml Solução Oral 60ml')).products,[]);
  const undocumented={...row,name:'Marca GTS',itemName:'Marca GTS'};
  assert.deepEqual((await retailerComparison(args,{search:async()=>[undocumented]},{})).products,[]);
});

test('a failed identity service preserves an explicit partner listing and cannot turn failure into zero stock',async()=>{
  const reference={drops:async()=>{throw new Error('reference offline');}};
  const local={...row,name:'Marca gotas 60ml',itemName:'Marca gotas 60ml'};
  const source={byGtin:async()=>[],search:async()=>[local]};
  assert.equal((await retailerComparison(query,source,reference)).products[0].sku,local.sku);
  source.search=async()=>[{...local,name:'Marca 10 mg comprimidos'}];
  await assert.rejects(retailerComparison(query,source,reference),/reference offline/);
});
