import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compare} from '../scripts/benchmark/actor.mjs';

const shared = {startedAt:'2026-11-01T12:00:00Z',finishedAt:'2026-11-01T12:00:10Z',input:{searchQueries:['A','B'],maxItems:8}};
const local = {...shared,source:'drogasil-cli',status:'succeeded',records:[
  {sku:'01',searchQuery:'A',currentPrice:0,listPrice:null,inStock:false},
  {sku:'02',searchQuery:'B',currentPrice:null},
]};
const actor = {...shared,source:'apify-run',status:'SUCCEEDED',records:[
  {sku:'02',searchQuery:'A',currentPrice:18},
  {sku:'01',searchQuery:'A',currentPrice:null,listPrice:null,inStock:false},
]};

test('paired timing is independent of row order, equality and billing evidence',()=>{
  const r=compare(local,actor);
  assert.equal(r.paired,true);
  assert.equal(r.compared,2);
  assert.equal(r.local.elapsedMs,10000);
  assert.deepEqual(r.attributionDifferences,[{sku:'02',local:'B',actor:'A'}]);
  assert.deepEqual(r.fields.currentPrice,{equal:0,different:2,bothNull:0,bothAbsent:0,localMissing:0,actorMissing:0,localNull:1,actorNull:1});
  assert.deepEqual(r.fields.listPrice,{equal:0,different:0,bothNull:1,bothAbsent:1,localMissing:1,actorMissing:1,localNull:1,actorNull:1});
  assert.equal(r.fields.inStock.equal,1);
  assert.deepEqual(r.local.fieldCoverage.currentPrice,{values:1,nulls:1,missing:0});
  assert.deepEqual(r.actor.fieldCoverage.inStock,{values:1,nulls:0,missing:1});
  assert.deepEqual(r.changedFields,[{sku:'01',fields:['currentPrice']},{sku:'02',fields:['currentPrice','searchQuery']}]);
  assert.equal(r.actor.chargedEventCounts,null);
  assert.equal(r.actor.usageTotalUsd,null);
  assert.equal(compare(local,{...actor,usageTotalUsd:0}).actor.usageTotalUsd,0);
});

test('old samples, different inputs, incomplete runs and missing timing cannot establish pairing',()=>{
  for (const change of [{status:'FAILED'},{source:'publisher-example'},{input:null},{input:{maxItems:2}},
    {input:{searchQueries:['B','A'],maxItems:8}},{finishedAt:null},
    {startedAt:'2026-10-01T12:00:00Z',finishedAt:'2026-10-01T12:00:10Z'}]) {
    assert.equal(compare(local,{...actor,...change}).paired,false);
  }
  assert.throws(()=>compare(local,{...actor,input:{pageSize:4}}),/Unexpected/);
});

test('reports export positions and relative order separately from successful paired execution',()=>{
  const rows=ids=>ids.map(sku=>({sku}));
  const report=(left,right)=>compare({...local,records:rows(left)},{...actor,records:rows(right)});
  const reversed=report(['10','20'],['20','10']);
  assert.equal(reversed.paired,true);
  assert.deepEqual(reversed.order,{comparableProducts:2,sameRelativeOrder:false,positionChanges:[
    {sku:'10',local:1,actor:2},{sku:'20',local:2,actor:1},
  ]});
  const shifted=report(['10','20'],['99','10','20']);
  assert.deepEqual(shifted.order,{comparableProducts:2,sameRelativeOrder:true,positionChanges:[
    {sku:'10',local:1,actor:2},{sku:'20',local:2,actor:3},
  ]});
  assert.deepEqual(report(['10','10','?','20'],['10','20']).order,{
    comparableProducts:1,sameRelativeOrder:null,positionChanges:[{sku:'20',local:4,actor:2}],
  });
  assert.deepEqual(report(['10'],['20']).order,{comparableProducts:0,sameRelativeOrder:null,positionChanges:[]});
  assert.deepEqual(report(['10','20'],['10','20']).order,{comparableProducts:2,sameRelativeOrder:true,positionChanges:[]});
});

test('downloaded exports share the same comparator and keep observation times, zero, false and omissions',()=>{
  const actorRow={sku:'01',currentPrice:0,listPrice:null,inStock:false,scrapedAt:'2026-10-27T12:00:00Z'};
  const localRow={...actorRow,currentPrice:null,stockSignal:0,scrapedAt:'2026-10-27T12:02:00Z'};
  const report=compare([localRow],[actorRow]);
  assert.equal(report.paired,false);
  assert.equal(report.sameInput,null);
  assert.equal(report.actor.usageTotalUsd,null);
  assert.equal(report.fields.inStock.equal,1);
  const [row]=report.observations;
  assert.equal(row.localMinusActorMs,120000);
  assert.deepEqual(row.differences.currentPrice,{actor:{state:'reported',value:0},local:{state:'null'}});
  assert.deepEqual(row.differences.stockSignal,{actor:{state:'absent'},local:{state:'reported',value:0}});
  const page={offset:0,nextOffset:null,count:1,state:'succeeded',records:[localRow]};
  assert.deepEqual(compare(page,[actorRow]).observations,report.observations);
  for (const incomplete of [{offset:1},{nextOffset:1},{count:2},{state:'running'}]) {
    assert.throws(()=>compare({...page,...incomplete},[actorRow]),/complete dataset/);
  }
  assert.throws(()=>compare([localRow],[{...actorRow,retailerId:'paguemenos'}]),/only Drogasil/);
  assert.throws(()=>compare(null,[actorRow]),/complete record arrays/);
});

test('diagnoses invalid and duplicate records without comparing an arbitrary copy',()=>{
  const r=compare({...local,records:[...local.records,{sku:'01'},{sku:2},{sku:'03'}]},
    {...actor,records:[...actor.records,{sku:'04'}]});
  assert.deepEqual(r.local.duplicateSkus,['01']);
  assert.equal(r.local.invalidSkuRows,1);
  assert.equal(r.shared,2);
  assert.equal(r.compared,1);
  assert.deepEqual(r.onlyLocal,['03']);
  assert.deepEqual(r.onlyActor,['04']);
});

test('reads an existing Actor run in bounded pages and retains its observed event counts',async()=>{
  const {actorRun}=await import('../scripts/benchmark/actor.mjs');
  const records=Array.from({length:115},(_,i)=>({sku:String(i+1)}));
  const base={'acts/automation-lab~drogasil-pharmacy-products-prices':{data:{id:'actor1'}},
    'actor-runs/run1':{data:{actId:'actor1',status:'SUCCEEDED',defaultKeyValueStoreId:'bucket1',
      defaultDatasetId:'dataset1',usageTotalUsd:0.23,chargedEventCounts:{'actor-start':1,'item-extracted':115}}},
    'key-value-stores/bucket1/records/INPUT':{maxItems:115},'key-value-stores/bucket1/records/RUN_STATS':{searchPages:3},
    'datasets/dataset1':{data:{itemCount:115}}};
  const read=async path=>{
    if (Object.hasOwn(base,path)) return base[path];
    if (path==='datasets/dataset1/items?format=json&offset=0&limit=100') return records.slice(0,100);
    if (path==='datasets/dataset1/items?format=json&offset=100&limit=15') return records.slice(100);
    assert.fail('Unexpected request '+path);
  };
  const result=await actorRun('run1',read,()=>assert.fail('No recent completion time was reported'));
  assert.deepEqual(result.records,records);
  assert.deepEqual(result.work,{searchPages:3});
  assert.equal(result.chargedEventCounts['item-extracted'],115);
  assert.equal(result.usageTotalUsd,0.23);
  assert.equal(result.eventUsage,null);
  assert.equal(result.accountedChargedEventCounts,null);
  for (const [submitted,form,supported] of [
    [{maxItems:115},'omitted',true], [{searchQueries:[]},'empty_array',false],
    [{searchQueries:['  ']},'contains_blank',false], [{searchQueries:'A'},'invalid_type',false],
    [null,'unavailable',null],
  ]) {
    const loaded=await actorRun('run1',path=>path.endsWith('/records/INPUT') ? submitted : read(path));
    assert.equal(loaded.queryInput,form);
    assert.equal(loaded.locallySupported,supported);
    assert.deepEqual(loaded.records,records);
    const report=compare(local,loaded);
    assert.equal(report.actor.queryInput,form);
    assert.equal(report.actor.usageTotalUsd,0.23);
    assert.equal(report.paired,false);
    if (!supported) assert.equal(report.sameInput,null);
  }
  await assert.rejects(actorRun('run1',p=>p.endsWith('/records/INPUT')?{unexpectedField:'x'}:read(p)),/Unexpected Actor input/);
  await assert.rejects(actorRun('run1',p=>p.includes('offset=100')?[]:read(p)),/Incomplete dataset read/);
  await assert.rejects(actorRun('run1',p=>p==='actor-runs/run1'?{data:{actId:'other'}}:read(p)),/different Actor/);
  await assert.rejects(actorRun('run1',p=>p==='actor-runs/run1'?{data:{actId:'actor1',status:'RUNNING'}}:read(p)),/still active/);
});

test('refreshes a newly finished Actor run once and reports the latest billing observation',async()=>{
  const {actorRun}=await import('../scripts/benchmark/actor.mjs');
  const finishedAt=new Date().toISOString();
  const base={actId:'actor1',status:'FAILED',defaultKeyValueStoreId:'bucket1',defaultDatasetId:'dataset1',finishedAt};
  const reported={'item-extracted':1,'run-started':1};
  const accounted={'run-started':1};
  const costs={'run-started':{eventTitle:'Run started',eventTotalUsd:0.005}};
  let reads=0,waits=0;
  const read=async (path,label)=>{
    if (label==='Actor metadata') return {data:{id:'actor1'}};
    if (label==='Run metadata') {
      reads++;
      return {data:reads===1 ? {...base,usageTotalUsd:0} : {...base,usageTotalUsd:0.005,
        chargedEventCounts:reported,accountedChargedEventCounts:accounted,eventUsage:costs}};
    }
    if (label==='Dataset metadata') return {data:{itemCount:0}};
    if (label==='INPUT' || label==='RUN_STATS') return null;
    assert.fail('Unexpected request '+path);
  };
  const wait=async ms=>{waits++; assert.ok(ms>0 && ms<=10000);};
  const snapshot=await actorRun('test1',read,wait);
  const result=compare([],snapshot).actor;
  assert.equal(reads,2);
  assert.equal(waits,1);
  assert.equal(result.status,'FAILED');
  assert.equal(result.rows,0);
  assert.equal(result.usageTotalUsd,0.005);
  assert.deepEqual(result.chargedEventCounts,reported);
  assert.deepEqual(result.accountedChargedEventCounts,accounted);
  assert.deepEqual(result.eventUsage,costs);
  assert.ok(Number.isFinite(Date.parse(result.billingObservedAt)));
  assert.equal(compare([],[]).actor.billingObservedAt,null);
  const oldRun={...base,finishedAt:'2020-01-01T00:00:00Z',eventUsage:{},accountedChargedEventCounts:{}};
  const old=await actorRun('test1',(path,label)=>label==='Run metadata' ? {data:oldRun} : read(path,label),
    ()=>assert.fail('Older runs can be read immediately'));
  assert.equal(old.usageTotalUsd,null);
  assert.deepEqual(old.eventUsage,{});
  assert.deepEqual(old.accountedChargedEventCounts,{});
  let seen=0;
  await assert.rejects(actorRun('test1',(path,label)=>label==='Run metadata'
    ? {data:++seen===1 ? base : {...base,status:'RUNNING'}} : read(path,label),wait),/still active/);
});
