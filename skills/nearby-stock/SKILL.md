---
name: nearby-stock
description: Locate participating Drogasil branches reporting stock for a specific product and location.
---

For a shopping or availability request, including a bare “Tem Frontal 2 mg?”, call `plan_purchase` once with every requested medication in `items` and the user's shared `origin`. No preliminary catalog, store, per-SKU, or route calls. Reuse a shared CEP or coordinates. Ask once for a location when missing. Preserve the original medication spelling, strength, release and pack. Set `quantity` in packs, `brand`, `genericOnly` or `selectedSku` for preferences the user actually stated. An ordinary brand-name query includes its matching generics and other brands.

“Onde tem mais perto?” means nearest stocked branch per option. Omit `store`. “O que tem na minha loja mais próxima?” pins one physical branch. Pass `store: "nearest"`, show its zero quantities, and use unknown for missing stock. If the request itself specifies conflicting releases, clarify first, for example “Você quis dizer Glifage XR ou Glifage de liberação imediata?” Keep unusual strengths such as 507 mg exactly as supplied.

Render one Markdown table per requested medication in the returned order. Use the returned option IDs and columns **# | Medicamento | Tipo | Farmácia | Distância | Preço de referência | Qtd. em estoque**. Include the returned `type` wherever product options appear. Put unavailable, unknown and failed variants in separate short notes. Explain missing comparison fields and ask for a SKU for ambiguous presentations or rows marked `needsSelection`. A lookup failure or unreadable quantity cannot establish zero stock.

For two or more medications, show the returned plans immediately. Show the ordered stops, products and packs at each, estimated total and straight-line round-trip distance. Merge the two headings when `objective` is `both`. Use `tradeoff` for the savings and change in stops and distance. Report any unfilled lines explicitly. Prices are catalog estimates for the participating branches checked. If `searchComplete` is false, label the plans best found and explain the optimum could not be verified. Flag unknown prices, stock or route data when reported.

Finish a basket with one optional question, e.g. “Alguma preferência? Pode responder ‘A2, B1’, ‘só Frontal para A’ ou ‘sem preferência’.” For an option-number reply, resolve each number to its SKU from the displayed table **before** the refresh. Send all original items, quantities and retained preferences in a single fresh `plan_purchase` call, putting that SKU in `selectedSku`. Report a newly unavailable choice. A “sem preferência” reply accepts the plans already shown.

For an explicit single-SKU request for multiple stockists (“quais lojas têm duas caixas desse SKU?”), use `find_nearby_stock` with the shared origin and minimumQuantity. If the user specifies one fixed nearest store, read nearestStore including zero or unknown. For stock questions about product options, use the numbered plan_purchase table.
