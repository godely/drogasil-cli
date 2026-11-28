import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {matchesCountedLabel} from '../api/counted-pack.js';
import {fold} from '../api/medications.js';
import {catalogType} from './catalog.js';

const normalize = value => fold(value ?? '').replace(/(\d),(\d)/g,'$1.$2').replace(/\s+/g,' ').trim();
const strings = (...values) => values.flat().filter(v => typeof v === 'string' && v.trim());
let registry;

function packRegistry() {
  if (registry) return registry;
  const data = JSON.parse(gunzipSync(readFileSync(new URL('../data/cmed-packs.json.gz',import.meta.url))));
  const byCode = new Map();
  for (const [row,codes,registration,name,category,ingredient,description] of data.rows) {
    const record = {row,registration,name,category,ingredient,description};
    for (const code of codes) {
      if (!byCode.has(code)) byCode.set(code,[]);
      byCode.get(code).push(record);
    }
  }
  registry = {source:data.source,sheet:data.sheet,sha256:data.sha256,byCode};
  return registry;
}

function presentation(record) {
  const label = normalize(record.description);
  // One oral solid in a retail carton. All dosage-form and release qualifiers
  // precede CT. Additional components, different strengths and kits stay out.
  const match = /^(\d+(?:\.\d+)?) (mg|mcg|g|ui) (com(?: rev)?|cap dura)(?: (lib retard|lib prol))? ct (?:bl|fr) [a-z0-9 /.-]+ x (\d+)$/.exec(label);
  if (!match || !record.ingredient || /[;+\/|]/.test(record.ingredient) || /\b(?:kit|dil|aplic|ser|env|dose|x \d)\b/.test(label.slice(label.indexOf(' ct ')+4,label.lastIndexOf(' x ')))) return null;
  const [,strength,unit,registeredForm,modifier,count] = match;
  if (!(Number(strength)>0 && Number(count)>0)) return null;
  return {ingredient:normalize(record.ingredient),strength:Number(strength),unit,count:Number(count),
    form:registeredForm.startsWith('com')?'comprimido':'capsula',registeredForm,modifier:modifier ?? null};
}

export function registeredPresentation(code, registrations = []) {
  const rows = packRegistry().byCode.get(String(code));
  if (!rows) return null;
  const declared = [registrations].flat().filter(v => v != null && v !== '').map(v=>String(v).replace(/\D/g,''));
  if (declared.some(v=>!v || !rows.some(row=>row.registration===v))) return null;
  const candidates = declared.length ? rows.filter(row=>declared.includes(row.registration)) : rows;
  const record = candidates[0];
  const pack = presentation(record);
  if (candidates.some(row => normalize(row.name)!==normalize(record.name) || row.category!==record.category ||
    JSON.stringify(presentation(row))!==JSON.stringify(pack))) return null;
  return {pack,name:record.name,category:record.category,records:candidates};
}

function releaseLabels(value) {
  const label = normalize(value);
  const releases = [];
  if (/libera[cç]ao (?:imediata|convencional)|\bIR\b/i.test(label)) releases.push('immediate');
  if (/libera[cç]ao (?:prolongada|lenta)|\b(?:xr|xl|er|sr|lp)\b/.test(label)) releases.push('lib prol');
  if (/libera[cç]ao retardada|\b(?:dr|retard|enteric\w*|gastrorresist\w*)\b/.test(label)) releases.push('lib retard');
  if (/libera[cç]ao (?:modificada|controlada|bifasica)|\b(?:cr|mr|depot)\b/.test(label)) releases.push('other');
  return releases;
}

const guidanceUrl = 'https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/similares';

function observedRelease(product, pack) {
  const facts = product.facts ?? {};
  const labels = strings(product.name, product.itemName, product.filters?.['Forma farmacêutica'],product.details?.quantidade,
    facts.Apresentação,facts['Forma Farmacêutica'],facts['Tipo de Liberação']);
  const observed = new Set(labels.flatMap(releaseLabels));
  if (strings(facts['Tipo de Liberação']).some(label=>!releaseLabels(label).length)) return 'unverified';
  if (pack.modifier && !observed.has(pack.modifier)) return 'unverified';
  if (observed.size>1 || observed.has('other')) return 'unverified';
  if (!pack.modifier && (observed.has('lib prol') || observed.has('lib retard'))) return 'unverified';
  return [...observed][0] ?? null;
}

// Strip a recognized release label only after its agreement with the registry
// has been checked. Unsupported qualifiers still reach the normal pack checks.
function withoutRelease(label) {
  return normalize(label).replace(/(?:de )?liberacao (?:imediata|convencional|prolongada|retardada|lenta)|\b(?:ir|xr|xl|er|sr|lp|dr|retard)\b/g,' ').replace(/\s+/g,' ').trim();
}

function compatibleQuery(query,pack,observed) {
  const label = normalize(query);
  if (/\b(?:gotas|solucao|suspensao|injetavel|sublingual|orodispersivel|mastigavel|efervescente|kit)\b|[+×/]/.test(label)) return false;
  if ([...label.matchAll(/\b(\d+(?:\.\d+)?)\s*(mcg|mg|g|ui)\b/g)].some(m=>Number(m[1])!==pack.strength || m[2]!==pack.unit)) return false;
  if ([...label.matchAll(/\b(\d+)\s*(comprimido|capsula|unidade)s?\b/g)].some(m=>Number(m[1])!==pack.count)) return false;
  if ([...label.matchAll(/\b(comprimido|capsula)s?\b/g)].some(m=>m[1]!==pack.form)) return false;
  return releaseLabels(label).every(release=>release===observed);
}

function consistentItemName(product) {
  if (!product.itemName) return true;
  const tokens = value => normalize(value).replace(/(\d)\s+(?=mcg|mg|g\b|ui)/g,'$1').replace(/[^\p{L}\d.]+/gu,' ').trim().split(/\s+/);
  const full = new Set(tokens(product.name));
  return tokens(product.itemName).every(token=>full.has(token));
}

function agreesWithListing(product,pack) {
  const facts=product.facts ?? {}, details=product.details ?? {}, filters=product.filters ?? {};
  const quantities = strings(facts.Quantidade,details.quantidade,product.packageQuantities);
  const forms = strings(filters['Forma farmacêutica'],facts.Apresentação,facts['Forma Farmacêutica']);
  const routes = strings(filters['Via de administração'],facts['Via de Administração'],facts['Formas de Administração'],facts['Forma de Administração']);
  if (routes.some(route=>!/^(?:(?:uso|via) )?oral$/.test(normalize(route)))) return false;
  if ([facts.Kit,details.é_kit,filters.Kit].flat().some(value=>/^(?:sim|yes|true|1)$/.test(normalize(value)))) return false;
  const structured = details.activeIngredients ?? [];
  if (structured.length>1 || (details.activeNumberIngredient!=null && Number(details.activeNumberIngredient)!==1)) return false;
  if (structured.some(a=>(a.dosageValue!=null && Number(normalize(a.dosageValue))!==pack.strength) ||
    (a.unitOfMeasurement?.name && normalize(a.unitOfMeasurement.name)!==pack.unit))) return false;
  const actives = strings(product.activeIngredients,facts.NomeSubstanciaPrincipioAtivo,facts['Princípio Ativo'],structured.map(a=>a.description));
  if (actives.some(a=>normalize(a).replace(/^com /,'')!==pack.ingredient)) return false;
  if (strings(facts.Dosagem,details.dosageList).some(s=>normalize(s).replace(/\s+/g,'')!==pack.strength+pack.unit)) return false;
  const release = observedRelease(product,pack);
  if (!consistentItemName(product) || release==='unverified' ||
      (product.itemName && !compatibleQuery(product.itemName,pack,release))) return false;
  const tags = [product.name,product.itemName,...forms].filter(Boolean).map(normalize);
  if (pack.registeredForm==='com' && tags.some(t=>/\brevestid/.test(t))) return false;
  if (pack.registeredForm==='cap dura' && tags.some(t=>/\bmoles?\b/.test(t))) return false;
  const name=withoutRelease(product.name);
  return matchesCountedLabel(pack,name,{pack:quantities,brand:product.brand}) &&
    forms.every(form=>matchesCountedLabel(pack,name,{form:withoutRelease(form)}));
}

function declaredGeneric(row) {
  if (catalogType(row)!=='Genérico') return false;
  const facts=row.facts ?? {};
  return !strings(facts['Tipo de Medicamento'],row.type).some(v=>/^(?:similar(?:es)?|referencia|novo)$/u.test(normalize(v))) &&
    ![facts.Generico].flat().some(v=>/^(?:nao|false|0)$/.test(normalize(v)));
}

// The reference has already identified the shopper's exact brand pack. For
// registered similares, compare catalog presentations outside a prescription
// fulfillment plan. Each price and checkout result must still come from the shop.
export async function compareRegisteredBrand(retailer, originals, brand, source, request = brand) {
  if (!originals.length) return null;
  const [anchor] = originals;
  const listed = packRegistry().byCode.get(String(anchor.eanCode)) ?? [];
  const registeredBrand = listed.find(row => row.category==='Similar' && normalize(row.name)===normalize(brand));
  if (!registeredBrand) return null;
  const ref = registeredPresentation(anchor.eanCode,anchor.details?.ms);
  if (!ref) return {registeredPresentation:{source:packRegistry().source,registeredBrand:registeredBrand.name,
    category:registeredBrand.category,records:[],guidanceUrl},comparisonOptions:[],comparisonStatus:'unverified_reference_presentation'};
  if (ref.category !== 'Similar' || normalize(ref.name)!==normalize(brand)) return null;
  const {source:url,sheet,sha256}=packRegistry();
  const evidence = {source:url,sheet,sha256,registeredBrand:ref.name,category:ref.category,records:ref.records,registeredRelease:ref.pack?.modifier ?? null,
    substitution:'not_interchangeable_with_generic',guidanceUrl};
  const base = {registeredPresentation:evidence,comparisonOptions:[]};
  if (!ref.pack || !compatibleQuery(request,ref.pack,observedRelease(anchor,ref.pack)) ||
      !originals.every(p=>String(p.eanCode)===String(anchor.eanCode) && agreesWithListing(p,ref.pack))) {
    return {...base,comparisonStatus:'unverified_reference_presentation'};
  }
  const {ingredient,strength,unit,count,form}=ref.pack;
  const query = ingredient+' '+strength+' '+unit+' '+count+' '+form+'s';
  const offers = new Map(), seen=new Set();
  let complete=false;
  for (let page=1;page<=20;page++) {
    let results;
    try { results=await source.search(query,page,50); }
    catch { return {...base,comparisonOptions:[...offers.values()],comparisonStatus:offers.size?'partial':'source_failed'}; }
    const before=seen.size;
    for (const row of results) {
      const key=JSON.stringify([row.sku,row.sellerId,row.gtin]);
      if (seen.has(key)) continue;
      seen.add(key);
      const other=registeredPresentation(row.gtin,row.facts?.NumeroRegistroMS);
      if (other?.category!=='Genérico' || !declaredGeneric(row) ||
          !(' '+normalize(row.name)+' ').includes(' '+ref.pack.ingredient+' ') ||
          JSON.stringify(other.pack)!==JSON.stringify(ref.pack) || !agreesWithListing(row,other.pack) ||
          !compatibleQuery(request,other.pack,observedRelease(row,other.pack))) continue;
      const {facts,...product}=row;
      offers.set(key,{...product,retailerId:retailer,type:'Genérico',role:'presentation_comparison',
        registeredRecords:other.records,matchBasis:'registered_pack_and_retailer_listing'});
    }
    if (results.length<50) {complete=true;break;}
    if (seen.size===before) break;
  }
  const comparisonOptions=[...offers.values()].sort((a,b)=>(a.currentPrice??Infinity)-(b.currentPrice??Infinity) || String(a.name).localeCompare(String(b.name),'pt-BR'));
  return {...base,comparisonOptions,comparisonStatus:complete?(offers.size?'documented':'no_verified_generic'):'partial'};
}
