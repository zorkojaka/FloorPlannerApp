---
name: verify
description: Kako pognati in E2E preveriti FloorPlanner (Vite + React + Playwright headless).
---

# Verifikacija FloorPlannerApp

## Zagon

```bash
npx vite --port 5199 &   # dev server; build ni potreben za verifikacijo
```

Aplikacija se odpre v pogledu **Workflow → Projekt** (4-koračni čarovnik). Stanje
je v localStorage (`floorplanner.*`) — za čist test najprej `localStorage.clear()`
in reload.

## Playwright (headless, brez UI paketov)

Playwright je v devDependencies, chromium je že v `~/.cache/ms-playwright`.
Skripto poganjaj iz scratchpada z absolutnim importom (ESM ne najde paketa iz /tmp):

```js
import { chromium } from '/home/jaka/apps/FloorPlannerApp/node_modules/playwright/index.mjs';
```

## Tokovi, vredni preverjanja

- **Korak 1 → 2**: gumb `Naprej → Razporeditev prostorov`; v koraku 2 vrstica
  `.floorProgress` (Kandidati/Družine/Raznolikost/Primerjave), A/B kartici
  `.floorPair .floorCard`, gumbi `A je boljša` / `enakovredni` / `naslednji par`.
- **Korak 3**: opremljena etaža `.floorBest .floorSvg`; klik na sobo =
  `g[style*="cursor"]` znotraj SVG → `.roomDrill` (Trenutna/A/B kartice,
  števec `N primerjav (tip)`).
- **Persistenca**: reload → `floorplanner.project.preference` (floor uteži,
  confidence) in `floorplanner.project.roomPrefs` (per-tip kanali) ostaneta.

## Pasti

- `console.error` / `pageerror` poslušaj vedno — JSX napake se sicer požrejo.
- Klik na sobo v koraku 3 zadene naključno sobo (WC ali pisarno) — tip preveri
  iz glave drill-a (`N primerjav (office|wc)`).
