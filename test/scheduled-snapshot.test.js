import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledSnapshot} from '../scripts/scheduled-snapshot.mjs';

const id = '7be8b9d7-be39-4f09-81eb-d09d53ab7bd4';
const env = {DROGASIL_WEBHOOK_URL:'https://example.test/watch'};
const dataset = {runId:id,state:'succeeded',count:1,records:[{sku:'17',currentPrice:0}],nextOffset:null};

test('a failed webhook delivery reuses the saved rows and key, without a second catalog collection', async () => {
  let collections = 0;
  const deliveries = [];
  const sources = {
    collect:async (terms, {maxItems}) => {
      assert.equal(terms,undefined);
      assert.equal(maxItems,20);
      collections++;
      return dataset;
    },
    read:async (run, page) => { assert.equal(run,id); assert.deepEqual(page,{limit:1000}); return dataset; },
    deliver:async (_url, {headers,body}) => {
      deliveries.push([headers['idempotency-key'],body]);
      return deliveries.length === 1 ? {ok:false,status:503} : {ok:true};
    },
  };
  await assert.rejects(scheduledSnapshot([], env, sources),{message:'Webhook delivery failed (HTTP 503). Retry with --run-id '+id});
  assert.equal(await scheduledSnapshot(['--run-id',id],env,sources),id);
  assert.equal(collections,1);
  assert.deepEqual(deliveries,[[id,JSON.stringify(dataset)],[id,JSON.stringify(dataset)]]);
});

test('invalid requests and incomplete saved runs never reach the destination', async () => {
  const sources = {collect:assert.fail,deliver:assert.fail,read:async () => ({...dataset,state:'failed'})};
  for (const [args, config] of [[['--run-id',id],{}],[['--run-id',id,'another'],env],
    [['--run-id','bad'],env],[[],{DROGASIL_WEBHOOK_URL:'http://example.test/'}]]) {
    await assert.rejects(scheduledSnapshot(args,config,sources),/Use /);
  }
  await assert.rejects(scheduledSnapshot(['--run-id',id],env,sources),/Incomplete snapshot/);
  await assert.rejects(scheduledSnapshot(['--run-id',id],env,{...sources,read:async()=>({...dataset,nextOffset:1})}),/Incomplete snapshot/);
});
