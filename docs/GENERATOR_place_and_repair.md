# Generator — place-and-repair (popravek NAČINA ISKANJA)

> Veja `fix/generator-repair`. NE spreminja PRAVIL (trda/mehka, kanali) —
> popravlja le, KAKO generator išče. Ocenjevanje (`evalPlace`, kanali) nedotaknjeno.

## Problem (znana omejitev iz HANDOFF)
Generator je iskal s čistim naključnim vzorčenjem: vsak poskus postavi VSE elemente
naključno; če kateri trči, se zavrže cel poskus. Ko se prostor napolni (npr. 4.
pisoar), veljavne rešitve OBSTAJAJO, a so ozke — naključje jih v danem številu
poskusov ne zadene in engine napačno javi "ni rešitve".

## NALOGA 1 — loči "nemogoče" od "nisem našel"
`searchLayouts` vrne `GenerateResult` s statusom:
- `infeasible` — DOKAZANO (predhodna `checkFeasibility`: vsota trdih jeder / zid /
  vrata ne gredo v prostor). Z razlogi.
- `not-found` — iskanje ni zadelo (morda obstaja); ni dokaz nemožnosti.
- `found` — najdeni kandidati.

UI pokaže pravo sporočilo; pri `not-found` ponudi gumb **"Razširi iskanje"**.

## NALOGA 2 — place-and-repair
Elemente postavljamo zaporedno (vrata najprej, nato fiksature od največje). Ko nov
element trči (footprint 3D / jedro / lok vrat / cona), ga **POPRAVIMO**: iz naključne
želene pozicije pometemo vzdolž zidu (in po ostalih zidovih) do **najbližjega
veljavnega mesta** — ne zavržemo celega poskusa. Tako najdemo ozke rešitve.
- Determinizem ohranjen (seedan `random`).
- Repair išče veljavnost, je NE zaobide — element se sme premakniti samo na mesto
  brez trka; končno veljavnost (prehodnost, halo v strogem načinu …) odloči `evalPlace`.
- Raznoliki kandidati: vsak poskus ima drugačno naključno željo → drugačna veljavna
  razporeditev.

## NALOGA 3 — hitra varovalka
Če bazno iskanje vrne prazno, `searchLayouts` ENKRAT samodejno razširi (×4 poskusov)
preden javi `not-found`. Poceni varovalka proti lažnim negativom.

## Dokaz (primer: 4 pisoarji + umivalnik + WC + vrata + okno, soba 3200×2600)
- **PRED** (čisto naključje, 1100 poskusov): `feasible=true`, `pool=0` → lažni "ni rešitve".
- **PO** (place-and-repair, isti seed): `pool=33` veljavnih razporeditev.
- Test: `src/engine/generatorRepair.test.ts`. Golden generacijski test posodobljen
  (place-and-repair najde mnogo več veljavnih: 47→204).
