import test from 'node:test';
import assert from 'node:assert/strict';
import {retailerComparison} from '../src/retailers/shopping.js';
import {purchaseCatalogNotice} from '../src/commands/plan.js';

const requested={name:'Exemplo 2 mg 30 comprimidos',sku:'1',eanCode:'7899547543766'};
const generic={name:'Substância 2 mg 30 comprimidos Genérico',sku:'2',eanCode:'7896004703398'};
const options={retailer:'paguemenos',query:requested.name,includeGenerics:true};
const match={status:'matches',requestedBrandName:'Exemplo',requestedBrandSkus:['1'],products:[requested,generic]};
function source(rows) {
  return {search:async()=>[], byGtin:async code=>{assert.equal(code,generic.eanCode);return rows;}};
}
const row={name:generic.name,gtin:generic.eanCode,sku:'42',currentPrice:8};

test('a missing exact brand pack can have verified local generics after consent',async()=>{
  const result=await retailerComparison(options,source([row,{...row,name:row.name+' + 1 Porta-Comprimidos'},
    {...row,name:'Substância XR 2 mg 30 comprimidos Genérico'}]),{compare:async()=>match});
  assert.equal(result.status,'matches');
  assert.deepEqual(result.requestedBrand,{name:'Exemplo',status:'no_exact_catalog_match'});
  assert.deepEqual(result.products.map(p=>[p.sku,p.role,p.type]),[['42','generic','Genérico']]);
  assert.equal(result.products[0].equivalenceEvidence.gtin,generic.eanCode);
  const unavailable=await retailerComparison(options,source([]),{compare:async()=>match});
  assert.equal(unavailable.status,'no_match');
  assert.match(purchaseCatalogNotice(unavailable),/caixa de Exemplo.*genérico com a mesma apresentação/);
  const partial=await retailerComparison(options,{search:async()=>[],byGtin:async()=>{throw Error('offline');}},{compare:async()=>match});
  assert.equal(partial.status,'partial');
  assert.doesNotMatch(purchaseCatalogNotice(partial) ?? '',/não encontrei|não encontrou/i);
});

test('brand-only, ambiguous and unrelated names cannot silently substitute generics',async()=>{
  const strict=await retailerComparison({...options,includeGenerics:false},source([]),{compare:()=>assert.fail()});
  assert.deepEqual(strict.products,[]);
  const ambiguous=await retailerComparison(options,source([]),{compare:async()=>({...match,status:'ambiguous',candidates:[requested]})});
  assert.equal(ambiguous.status,'choose_reference');
  assert.deepEqual(ambiguous.products,[]);
  assert.deepEqual(ambiguous.presentationChoices,[requested.name]);
  const wrong=await retailerComparison(options,source([]),{compare:async()=>({...match,requestedBrandName:'Outra'})});
  assert.equal(wrong.status,'no_match');
});

test('reference-only presentations use distinct product names and carry no local price or offer', async () => {
  const names = ['Exemplo 2 mg 30 comprimidos', 'Exemplo XR 2 mg 30 comprimidos'];
  const compare = async () => ({...match,status:'ambiguous',
    candidates:[...names, names[0], ' '].map(name => ({name,sku:'123',price:20}))});
  const result = await retailerComparison(options,source([]),{compare});
  assert.deepEqual(result.presentationChoices,names);
  assert.equal(result.referenceCatalog,'drogasil');
  assert.deepEqual(result.products,[]);
  for (const status of ['choose_reference','ambiguous']) {
    const notice = purchaseCatalogNotice({...result,status});
    for (const name of names) assert.ok(notice.includes('• '+name));
    assert.match(notice,/catálogo de referência da Drogasil/);
    assert.doesNotMatch(notice,/R\$|123/);
  }
  const unnamed = await retailerComparison(options,source([]),{compare:async () => ({...match,status:'ambiguous',candidates:[]})});
  assert.equal(unnamed.status,'incomplete_presentation');
});
