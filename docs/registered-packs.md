# Registered pack comparisons

When a partner's search misses a named brand after the shopper agrees to see generics, the library can compare exact registered presentations. For a similar medicine, each generic is quoted separately. The basket keeps the requested brand unresolved. Anvisa explains the rules for a prescribed similar on its [medicamentos similares page](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/similares).

The index records pack identifiers, registration numbers, ingredients, product classification and the original presentation text from the [CMED consumer price list](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos). Its source URL, workbook hash, worksheet and original row numbers accompany matches. Prices and pickup offers come from the selected retailer at request time. The November 2026 snapshot contains 26,596 rows with validated barcodes. The index loads once in a server process when needed.

Download the dated workbook from Anvisa and run the following from the project root, supplying its official download URL.

```sh
python3 scripts/build-cmed-packs.py lista_pmc.xlsx src/data/cmed-packs.json.gz --source "$ANVISA_PMC_WORKBOOK_URL"
node --test test/registered-packs.test.js
```

A retailer-declared registration must match a row for that barcode. Multiple rows may agree on presentation while differing in blister material. A conflict leaves the presentation unconfirmed. The comparison recognizes single-ingredient counted oral tablets and hard capsules with a documented carton size. Release modifiers require agreement in both listings and the registered packs. A blank registered release field stays unknown. Other forms require their own evidence.
