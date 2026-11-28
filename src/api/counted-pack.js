// Direct shopping listings for a named single ingredient. The caller already
// resolved the ingredient; brand substitution uses the stricter equivalence path.
import { fold } from './medications.js';

const normalized = text => fold(text ?? '').replace(/(\d),(\d)/g, '$1.$2');
const dosePattern = /\b(\d+(?:\.\d+)?)\s*(mcg|mg|g|ui)\b/g;
const countPattern = /\b(\d+)\s*(comprimido|capsula)s?\b/g;

export function countedPack(suffix) {
  const match = normalized(suffix).match(/^(\d+(?:\.\d+)?)\s*(mcg|mg|g|ui)\s*[, -]*\s*(?:(?:caixa|embalagem)\s+(?:de|com)\s+|com\s+)?(\d+)\s*(comprimido|capsula)s?$/);
  if (!match || Number(match[1]) <= 0 || Number(match[3]) <= 0) return null;
  return { strength: Number(match[1]), unit: match[2], count: Number(match[3]), form: match[4] };
}

export function directCountedListing(product, ingredient, request) {
  const details = product.details ?? {};
  const [active] = details.activeIngredients ?? [];
  if (details.activeIngredients?.length !== 1 || (details.activeNumberIngredient != null && Number(details.activeNumberIngredient) !== 1)
      || normalized(active?.description) !== normalized(ingredient)
      || Number(normalized(active.dosageValue)) !== request.strength
      || normalized(active.unitOfMeasurement?.name) !== request.unit) return false;

  return matchesCountedLabel(request, product.name, { pack: details.quantidade, form: product.filters?.['Forma farmacêutica'],
    route: product.filters?.['Via de administração'], brand: product.brand });
}

export function matchesCountedLabel(request, name, fields = {}) {
  const title = normalized(name), pack = normalized(fields.pack), form = normalized(fields.form);
  const route = normalized(fields.route);
  const evidence = [title, pack, form, normalized(fields.brand)].join(' ');
  if (route && !/^(?:(?:uso|via)\s+)?oral$/.test(route)) return false;
  // A modifier, a combination pack or a second strength needs clarification.
  if (/\b(?:xr|xl|sr|cr|er|dr|la|lp|mr|retard|chrono|depot|kit|brinde|gratis|liberacao|dispers\w*|orodispers\w*|sublingu\w*|mastig\w*|efervesc\w*|gastrorresist\w*|enteric\w*|vagin\w*|retal|nasal|topico|oftalm\w*|bucal|bicamada|leve\s+\d+)\b|[+/×]|\d\s*x\s*\d/.test(evidence)) return false;
  if (form && !new RegExp('^' + request.form + 's?(?: revestid[oa]s?| duras?| moles?)?$').test(form)) return false;
  const doses = [...title.matchAll(dosePattern)];
  const counts = [...title.matchAll(countPattern)];
  return doses.length === 1 && Number(doses[0][1]) === request.strength && doses[0][2] === request.unit
    && counts.length === 1 && Number(counts[0][1]) === request.count && counts[0][2] === request.form
    && (!/^\d+$/.test(pack) || Number(pack) === request.count)
    && [...pack.matchAll(/(\d+)\s*unidades?\b/g)].every(m => Number(m[1]) === request.count)
    && [...pack.matchAll(countPattern)].every(m => Number(m[1]) === request.count && m[2] === request.form);
}
