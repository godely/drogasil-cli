import test from 'node:test';
import assert from 'node:assert/strict';
import { getStoreDirectory } from '../src/api/index.js';

const sample = (id,city,neighborhood,latitude) => ({id, storeName:'DROGASIL', fantasyName:'Filial '+id,
  address:{regionId:'PE',cityName:city,neighborhood,latitude,longitude:-34},
  labelAttendance:['Seg a sex 08:00 às 20:00'], telephone:'12345678 / 987654321 ', telephoneAreaCode:81});
const rows = [sample(1,'Cidade','Graças',null),sample(2,'Cidade','Centro',-8.01),
  sample(3,'CIDADE','GRACAS',-8),sample(4,'Outra cidade','Graças',-8.1)];
const sources = { read:async args=>{assert.equal(args.detailed,true);return rows;},
  addressFor:async ()=>({ufSg:'pe',locationName:'Cidade',neighborhoodName:'graças'}) };

test('coordinates rank the entire directory, keeping unlocated branches last and addresses and hours intact', async()=>{
  const d=await getStoreDirectory({latitude:-8,longitude:-34},sources);
  assert.equal(d.order,'straight_line_distance');
  assert.deepEqual(d.stores.map(s=>s.id),[3,2,4,1]);
  assert.equal(d.stores[0].distanceKm,0);
  assert.equal(d.stores[3].distanceKm,null);
  assert.equal(d.stores[0].displayName,'Filial 3');
  assert.deepEqual(d.stores[0].phones,['(81) 12345678','(81) 987654321']);
  assert.match(d.stores[0].openingHours[0],/08:00/);
});

test('postal directory matches state, city and neighborhood, and distinguishes unknown location from no local branches',async()=>{
  const origin={zipcode:'01001000'};
  const d=await getStoreDirectory(origin,sources);
  assert.deepEqual(d.stores.map(s=>s.id),[1,3]);
  assert.equal(d.scope,'neighborhood');
  assert.ok(d.stores.every(s=>!('distanceKm' in s)));
  const city=await getStoreDirectory(origin,{...sources,addressFor:async()=>({ufSg:'PE',locationName:'Cidade'})});
  assert.equal(city.scope,'city'); assert.equal(city.stores.length,3);
  const missing=await getStoreDirectory(origin,{addressFor:async()=>null,read:assert.fail});
  assert.equal(missing.status,'location_unconfirmed');
  const empty=await getStoreDirectory(origin,{...sources,read:async()=>[]});
  assert.equal(empty.status,'checked'); assert.equal(empty.stores.length,0);
  const national=await getStoreDirectory(undefined,{...sources,addressFor:assert.fail});
  assert.equal(national.stores.length,4); assert.equal(national.order,'directory');
});
