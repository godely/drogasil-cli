import test from 'node:test';
import assert from 'node:assert/strict';
import {retailerBasket} from '../src/retailers/shopping.js';

test('joint basket preserves a branch identity failure separately from unavailable or unconfirmed pickup',async()=>{
  const scenarios = [
    [['lookup_failed','lookup_failed'],'source_failed'],
    [['lookup_failed','unavailable'],'partial'],
    [['unavailable','unavailable'],'unavailable'],
    [['unverified','unverified'],'unconfirmed'],
    [['available','available'],'fulfillable'],
  ];
  for (const [outcomes,expected] of scenarios) {
    const source={
      product:async sku=>[{sku,sellerId:'1',name:'Exemplo',currentPrice:10}],
      basket:async lines=>lines.map(({offer,quantity},i)=>({...offer,requestedQuantity:quantity,localStatus:outcomes[i],
        methods:outcomes[i]==='available'?[{channel:'delivery'}]:[],
        pickupVerification:{status:'directory_failed'}})),
    };
    const result=await retailerBasket({retailer:'drogariasaopaulo',items:[{sku:'1',quantity:1},{sku:'2',quantity:1}]},source);
    assert.equal(result.status,expected);
    assert.equal(result.items[0].pickupVerification.status,'directory_failed');
    assert.equal(result.deliveryForEveryItem,expected==='fulfillable');
    assert.deepEqual(result.commonPickupPoints,[]);
  }
});
