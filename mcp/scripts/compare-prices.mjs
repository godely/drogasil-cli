import { compareRetailPrices } from 'drogasil-cli';
import { retailers } from '../retailers.js';
const [query, first, second, ...extra] = process.argv.slice(2);
if (!query || !first || extra.length) throw new Error('Use <query> <CEP> or <query> <latitude> <longitude>');
const origin = second === undefined ? {zipcode:first} : {coordinates:{latitude:first,longitude:second}};
console.log(JSON.stringify(await compareRetailPrices(query,{...origin, retailers}), null, 2));
