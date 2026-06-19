# NADGRADNJA 5.0 — Poti kot vidni trak nastavljive širine

> Predpostavlja Nadgradnje 2.0, 3.0, 4.0 kot narejene/zaklenjene smeri.
> Status: smer za preizkušanje.
>
> **Posodobitev:** abstrakcija "profil prometa" (pešec/voziček/viličar) je
> **odstranjena** iz UI in modela. Namesto nje uporabnik nastavi **širino poti
> neposredno (mm)**, z dvema rangoma: minimalna (trdo) in želena (mehko).

---

## 1. Pot je VIDNI objekt (steklena škatla)

Prehodnost ni samo številka v ozadju. **Pot se nariše kot trak** — dejanska trasa
od vrat do uporabne točke vsakega elementa, čez tloris, **debeline = širina poti**.

- **vidiš**, zakaj je razporeditev dobra/slaba (trak vs črta),
- označena je **najožja točka** (z izpisom širine v mm),
- ob zavrnitvi zaradi prehodnosti je označeno **mesto blokade** (×).

Razhroščevanje z očmi namesto z ugibanjem.

Implementacija: `findPath(grid, from, to, width)` (`src/engine/freespace.ts`) vrne
`{ reachable, path, minWidth, narrowest, blockedAt }`.

---

## 2. Dva ranga = dve širini (neposredno nastavljivo)

Namesto enote profila uporabnik nastavi dve širini traku:

- **Minimalna širina (rang 1, TRDO):** prehodnost — da sploh prideš od vrat do
  elementa s trakom te širine. **Pod njo razporeditev ni veljavna** (pogoj).
  Vezana v `evalPlace(..., minPathWidth)` in `generateLayoutPool({ minPathWidth })`.
- **Želena širina (rang 2, MEHKO):** udobje / da se dva srečata. Vpliva **le na
  oceno** (udobje), nikoli ne zavrne — daje prednost razporeditvi z več zraka.

V UI: dva drsnika (`Minimalna (trdo)`, `Želena (mehko)`). Trak na tlorisu je
debel = minimalna; bled širši trak v ozadju = želena.

POGOJ USPEHA (izpolnjeno): sprememba minimalne vidno vpliva na **veljavnost**
(regenerira bazen, neprehodne padejo), sprememba želene vidno vpliva na **oceno
udobja** brez spremembe veljavnosti.

---

## 3. Geometrija gibanja — odloženo

Pešec/voziček se obrne na mestu; viličar potrebuje krivuljo (radij obračanja).
Za MVP **širina poti zadošča**. Obračanje (omejitev ukrivljenosti poti, radij) je
**odloženo za proizvodno domeno** — ni implementirano, le zabeleženo tu in v kodi
(`src/engine/freespace.ts`). Vstopna točka brez predelave: `findPath` že dela na
mreži prostih celic, radijsko omejitev bi dodali kot filter sosedov v A\*.

---

## 4. Implementacija (naveže se na 3.0)

- **Prosti prostor:** mreža (~100 mm celic) z višinskim filtrom (iz 3.0).
- **Vozlišča:** vrata → uporabna točka elementa (`doorInteriorPoint`, `usagePoint`).
- **Rang 1 (trdo):** A\* / BFS skozi proste celice s clearance ≥ minimalna/2;
  obstaja pot. Pod pragom → `ni prehodne poti do X` (nevalidno).
- **Rang 2 (mehko):** najožja dejanska širina poti vs želena → ocena udobja.
- **Vizualizacija:** trak (min + želena) + najožja točka + mesto blokade.

---

## 5. Ekonomika računanja — kje sme biti počasen, kje mora biti hiter

> Računalniški čas je poceni in skalabilen; projektantov čas je drag in ne skalira.

- **Generiranje** (engine išče rešitve) — **sme biti počasno**, teče vnaprej → bazen.
- **Interakcija** (izbiranje, A/B, korak 3) — **mora biti hitra** (bazen že imava).

Aktivno učenje (4.0) varčuje drag človeški čas (manj izbir); generiranje požira
poceni strojni čas. Vsak optimiziran tam, kjer šteje.

---

*Povzetek 5.0: pot je viden trak nastavljive širine (steklena škatla); dva ranga
= dve širini — minimalna (trdo, veljavnost) in želena (mehko, ocena udobja);
profil prometa odstranjen; obračanje viličarja (radij) odloženo za proizvodno
domeno.*
