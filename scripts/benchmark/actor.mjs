import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {collectSnapshot,readSnapshot} from '../../src/snapshots/index.js';

const actorName = 'automation-lab~drogasil-pharmacy-products-prices';
const columns = ['sku','name','brand','categories','categoryPath','productUrl','currentPrice','listPrice',
  'discountPercentage','currency','stockSignal','inStock','searchQuery','sourceUrl','scrapedAt'];
const jsonFile = async path => JSON.parse(await readFile(path,'utf8'));

function request(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key=>!['searchQueries','maxItems'].includes(key))) throw Error('Unexpected Actor input');
  const {searchQueries=['paracetamol'],maxItems=20} = input;
  if (!Array.isArray(searchQueries) || searchQueries.length < 1 || searchQueries.length > 10 ||
      searchQueries.some(q=>typeof q !== 'string' || !q.trim() || q.trim().length > 150) ||
      !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1000) throw Error('Invalid snapshot input');
  return {searchQueries:[...new Set(searchQueries.map(q=>q.trim()))],maxItems};
}

async function local(input) {
  const {searchQueries,maxItems} = request(input);
  const run = await collectSnapshot(searchQueries,{maxItems});
  const finishedAt = new Date().toISOString();
  const page = await readSnapshot(run.runId,{limit:maxItems});
  if (page.records.length !== page.count) throw Error('Incomplete local dataset read');
  return {source:'drogasil-cli',input,status:page.state,startedAt:page.startedAt,finishedAt,
    work:page.stats,records:page.records};
}

async function get(url,label,optional=false) {
  const token = process.env.APIFY_TOKEN;
  const response = await fetch(new URL('/v2/'+url,'https://api.apify.com'),{
    headers:token ? {Authorization:'Bearer '+token} : {},redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw Error(label+' returned HTTP '+response.status);
  return response.json();
}

// GET only. Run identifiers can grant read access and stay out of the exported report.
export async function actorRun(id,read=get) {
  if (!/^[a-zA-Z0-9]+$/.test(id)) throw Error('Expected an Apify run ID');
  const [{data:actor},{data:run}] = await Promise.all([read('acts/'+actorName,'Actor metadata'),
    read('actor-runs/'+id,'Run metadata')]);
  if (!actor.id || run.actId !== actor.id) throw Error('The run belongs to a different Actor');
  if (!['SUCCEEDED','FAILED','TIMED-OUT','ABORTED'].includes(run.status)) throw Error('Run is still active; read the same run after it finishes');
  const bucket='key-value-stores/'+run.defaultKeyValueStoreId+'/records/';
  const [input,work,{data:dataset}] = await Promise.all([read(bucket+'INPUT','INPUT',true),read(bucket+'RUN_STATS','RUN_STATS',true),
    read('datasets/'+run.defaultDatasetId,'Dataset metadata')]);
  if (!Number.isInteger(dataset.itemCount) || dataset.itemCount < 0 || dataset.itemCount > 1000) throw Error('Unexpected dataset size');
  const records=[];
  while (records.length < dataset.itemCount) {
    const limit=Math.min(100,dataset.itemCount-records.length);
    const page=await read('datasets/'+run.defaultDatasetId+'/items?format=json&offset='+records.length+'&limit='+limit,'Dataset page');
    if (!Array.isArray(page) || !page.length || page.length > limit) throw Error('Incomplete dataset read');
    records.push(...page);
  }
  return {source:'apify-run',input:input === null ? null : request(input),status:run.status,build:run.buildNumber,
    startedAt:run.startedAt,finishedAt:run.finishedAt,records,work,
    chargedEventCounts:run.chargedEventCounts ?? null,usageTotalUsd:run.usageTotalUsd ?? null};
}

function index(rows) {
  const products=new Map(),duplicates=new Set();
  let invalid=0;
  for (const row of rows) {
    if (typeof row?.sku !== 'string' || !/^\d+$/.test(row.sku)) { invalid++; continue; }
    if (products.has(row.sku)) duplicates.add(row.sku);
    else products.set(row.sku,row);
  }
  return {products,duplicates,invalid};
}

function timing(run) {
  const start=Date.parse(run.startedAt), end=Date.parse(run.finishedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end>=start ? {start,end,elapsedMs:end-start} : null;
}

export function compare(local,actor) {
  if (!Array.isArray(local.records) || !Array.isArray(actor.records)) throw Error('Expected complete record arrays');
  const a=index(local.records), b=index(actor.records);
  const aTime=timing(local), bTime=timing(actor);
  const overlap=aTime && bTime ? Math.max(aTime.start,bTime.start)<=Math.min(aTime.end,bTime.end) : null;
  const sameInput=local.input && actor.input ? isDeepStrictEqual(request(local.input),request(actor.input)) : null;
  const paired=local.source==='drogasil-cli' && actor.source==='apify-run' && local.status==='succeeded' &&
    actor.status==='SUCCEEDED' && sameInput===true && overlap===true;
  const shared=[...a.products.keys()].filter(id=>b.products.has(id));
  const comparable=shared.filter(id=>!a.duplicates.has(id) && !b.duplicates.has(id));
  const timeGapsMs=comparable.flatMap(id=>{
    const left=Date.parse(a.products.get(id).scrapedAt), right=Date.parse(b.products.get(id).scrapedAt);
    return Number.isFinite(left) && Number.isFinite(right) ? [Math.abs(left-right)] : [];
  }).sort((x,y)=>x-y);
  const fields={};
  for (const field of columns) {
    let equal=0, different=0, bothNull=0,localMissing=0,actorMissing=0,localNull=0,actorNull=0;
    for (const id of comparable) {
      const left=a.products.get(id), right=b.products.get(id);
      const l=Object.hasOwn(left,field), r=Object.hasOwn(right,field);
      if (!l) localMissing++;
      if (!r) actorMissing++;
      if (l && left[field]===null) localNull++;
      if (r && right[field]===null) actorNull++;
      if (!l || !r) continue;
      if (left[field]===null && right[field]===null) bothNull++;
      else if (isDeepStrictEqual(left[field],right[field])) equal++;
      else different++;
    }
    fields[field]={equal,different,bothNull,localMissing,actorMissing,localNull,actorNull};
  }
  function fieldCoverage(rows) {
    return Object.fromEntries(columns.map(field=>{
      let present=0, nulls=0;
      for (const row of rows) {
        if (row && Object.hasOwn(row,field)) {
          present++;
          if (row[field]===null) nulls++;
        }
      }
      return [field,{values:present-nulls,nulls,missing:rows.length-present}];
    }));
  }
  const summarize=(run,idx,time)=>({status:run.status ?? null,rows:run.records.length,unique:idx.products.size,
    invalidSkuRows:idx.invalid,duplicateSkus:[...idx.duplicates],startedAt:run.startedAt ?? null,
    finishedAt:run.finishedAt ?? null,elapsedMs:time?.elapsedMs ?? null,
    rowsPerSecond:time?.elapsedMs > 0 ? run.records.length*1000/time.elapsedMs : null,
    fieldCoverage:fieldCoverage(run.records),work:run.work ?? null});
  return {paired,sameInput:sameInput ?? null,windowsOverlap:overlap,local:summarize(local,a,aTime),
    actor:{...summarize(actor,b,bTime),build:actor.build ?? null,chargedEventCounts:actor.chargedEventCounts ?? null,
      usageTotalUsd:actor.usageTotalUsd ?? null},shared:shared.length,compared:comparable.length,
    observationGapsMs:{datedPairs:timeGapsMs.length,minimum:timeGapsMs[0] ?? null,maximum:timeGapsMs.at(-1) ?? null},
    onlyLocal:[...a.products.keys()].filter(id=>!b.products.has(id)),onlyActor:[...b.products.keys()].filter(id=>!a.products.has(id)),
    attributionDifferences:comparable.filter(id=>a.products.get(id).searchQuery!==b.products.get(id).searchQuery)
      .map(sku=>({sku,local:a.products.get(sku).searchQuery ?? null,actor:b.products.get(sku).searchQuery ?? null})),
    changedFields:comparable.map(sku=>{
      const left=a.products.get(sku),right=b.products.get(sku);
      return {sku,fields:columns.filter(field=>Object.hasOwn(left,field)!==Object.hasOwn(right,field) ||
        !isDeepStrictEqual(left[field],right[field]))};
    }).filter(row=>row.fields.length),fields};
}

async function main([action,first,second,...extra]) {
  if (extra.length) throw Error('Unexpected arguments');
  if (action==='collect' && first && !second) return local(await jsonFile(first));
  if (action==='read-actor' && first && !second) return actorRun(first);
  if (action==='compare' && first && second) return compare(await jsonFile(first),await jsonFile(second));
  throw Error('Use collect INPUT.json | read-actor RUN_ID | compare LOCAL.json ACTOR.json');
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await main(process.argv.slice(2)),null,2));}
  catch (err) {console.error(err.message); process.exitCode=1;}
}
