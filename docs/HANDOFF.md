# HANDOFF — Generativni Layout Engine → MVP

> Namen tega dokumenta: Claude Code (ali kdorkoli) lahko od tu nadaljuje in **izpelje MVP do konca**, brez da bi karkoli od dosedanjega razmišljanja izgubili. To je edini vir resnice o arhitekturi, zaklenjenih odločitvah in preostalem delu.

---

## 0. Teza v enem stavku

Generičen, **deterministični** engine postavlja enote (opremo) v prostor ob spoštovanju trdih omejitev; **znanje** (pravila kot spekter-envelope) pride iz referenc, ne iz kode; AI vstopi samo na dveh mestih — **indukcija pravil** in **razlaga**. Isti engine kasneje postavlja sobe v stavbo (gnezdenje).

Poslovni kontekst (za razumevanje, ne za MVP): cilj je orodje za projektantski oddelek velikega reguliranega proizvajalca (farmacija/GMP). Zato so **razlagljivost**, **trda vs mehka pravila** in **indukcija iz njihovih validiranih projektov** ključni. MVP se dela na nevtralni domeni (sanitarije/WC), ker jo product owner obvlada in lahko presodi smiselnost.

---

## 1. Zaklenjena arhitektura (NE relitigirati)

Glej `docs/ARCHITECTURE.md` za diagrame. Bistvo:

**Generični pogon** (en sam, parametriziran z enota+prostor):
```
brief → izvedljivost → regulator(global/specifično) → generator
   → routing(O5) → ocena(global+specifični score + kazni mehkih) 
   → bazen + LOG → A/B izbor → učenje uteži → konvergenca → rezultat
```

**Dvonivojsko znanje:** `scope: "global" | "room-type"`. Globalni prior (telesna/vedenjska načela, velja za vse sobe) + specifični nabori (per tip sobe). Regulator meša glede na količino referenc (malo → nasloni na global). *Struktura je vgrajena že zdaj (scope tag); mehanika mešanja se aktivira ob drugi sobi.*

**Orehe (vrstni red reševanja):** `O1 → O2 → O5 → O9`. Med njimi vse hardcodano.

**Gnezdenje (dva nivoja istega pogona):**
- Oreh 1 (MVP): enota=oprema, prostor=soba → opremljena soba + nauči se **koliko prostora soba rabi**.
- Oreh 2 (po MVP): enota=soba, prostor=stavba → razporeditev sob; vsaka postavljena soba postane nov "prostor" za oreh 1.

---

## 2. Stanje zdaj (kaj je zgrajeno)

Delujoč prototip je v eni datoteki: **`layout_engine_steps.jsx`** (React artifact). Vsebuje harmoniko korakov:

- **O1 — Model elementa (DELUJE).** Inšpektor: priklopne točke (vlečljive), orientacija sledi servisni strani, clearance kot spekter (jedro/halo/nasičenje/zaupanje), scope global/room-type, vir default/uporabnik.
- **O2 — Postavitev v sobo (DELUJE).** Generator postavlja opremo + vrata, trda jedra se ne prekrivajo, mehki halo se sme (s kaznijo), preklop strogo/mehko, A/B-pripravljen pool + ocena. Vrata z lokom kot trdim pravilom, smer Noter/Ven, tečaj levo/desno, fiksna pozicija. **Vmesnik omejitev**: prepovedane cone (no-go) + fiksna vrata = uporabnik vnese realnost, model se prilagodi ali javi neizvedljivost.
- **O5, O9 — zložena, NISTA zgrajena.**

Prejšnji samostojni artifacti (`wc_layout_engine.jsx`, `o1_element_inspector.jsx`) so zgodovinski; **kanoničen je `layout_engine_steps.jsx`.**

---

## 3. Podatkovni modeli (POGODBE — implementiraj dosledno)

```ts
// Element — odtis + servisni profil. NE ikona, ampak logika.
interface Element {
  category: string;                 // "toilet" | "sink" | "urinal" | "door" ...
  kind?: "door";                    // posebna obravnava vrat
  name: string;
  w: number;                        // mm, širina ob montažnem zidu
  d: number;                        // mm, globina v sobo
  source: "default" | "ifc" | "user"; // "user" = TRDA lastnost (povozi vse)
  conns: Connection[];
  clear: Envelope;                  // clearance kot spekter (vrata: lok = jedro)
}

interface Connection {
  id: string;
  type: "water-in" | "water-out" | "electric" | "vent";
  side: "back" | "front" | "left" | "right"; // privzeto "back"
  off: number;                      // 0..1 vzdolž strani (vizualno; logika gleda `side`)
  routesTo: "wall" | "floor";       // priklop na ZID definira orientacijo; TLA ne vežejo
}

// Vsako KOLIČINSKO pravilo je envelope, NE številka.
interface Envelope {
  core: number;   // mm — TRDO: nikoli manj (gnezdeno znotraj halo)
  halo: number;   // mm — MEHKO: smiselno do (sme se upogniti s kaznijo)
  sat:  number;   // mm — nasičenje: dlje ne pomaga
  conf: number;   // 0..1 — zaupanje iz variance; nizko → trdo degradira v mehko
  scope: "global" | "room-type";
}

// Vmesnik omejitev — zdaj ga polni uporabnik, kasneje engine za razporeditev sob.
type Constraint =
  | { type: "nogo"; x: number; y: number; w: number; h: number }; // nič vanjo
// + pripenjanje elementov prek ProgramInstance (fiksna vrata ipd.)

interface ProgramInstance {
  id: string;
  key: string;                      // ključ elementa v knjižnici
  // vrata:
  w?: number; dir?: "auto"|"inward"|"outward"; hinge?: "auto"|0|1;
  wall?: "auto"|"N"|"E"|"S"|"W"; fixedPos?: boolean; fpos?: number; // 0..1
  // (kasneje) oprema: fixed?: boolean; wall?, fpos?
}
```

**Orientacija (izpeljana, ne ročna):** `serviceSides = strani s conn.routesTo === "wall"`.
- 0 → prost element (otok)
- 1 → ob zidu, 4 orientacije
- 2 sosednji → vogal (4 vogali) *(vogalna geometrija odložena)*
- 2 nasprotni / >2 → fizično nemogoče (javi)

**Trde omejitve (NIKOLI kršene):** oprema v sobi; footprint-footprint brez prekrivanja; trdo jedro ne prekriva footprinta ali drugega jedra; lok vrat (navznoter) prost; odprtina+prehod vrat prosta; no-go cone proste; prehod ≥ min; vsaj ena vrata; veljavna orientacija.

**Mehke (kaznovane, optimizirane):** prekrivanje halo, dolžina odtoka, ipd. → utežena ocena; A/B uči uteži.

---

## 4. Struktura repozitorija (cilj)

Razbij `layout_engine_steps.jsx` na module. Engine mora biti **čist TS, brez React odvisnosti** (testabilen, ponovno uporabljiv za oreh 2).

```
/src
  /elements
    model.ts          // Element, Connection, orientation()
    library.ts        // privzeta knjižnica (default elementi)
  /rules
    envelope.ts       // Envelope tip + utili (degradacija conf→soft)
    ruleset.ts        // global prior + room-type nabori (zdaj ročno)
    induction.ts      // O9: reference/IFC → Envelope[] (AI klic)
  /engine
    generator.ts      // postavitev (sampling/optimizacija), respektira trdo
    evaluator.ts      // hard/soft preverbe, metrike, score
    routing.ts        // O5: trase od priklopov → mokri zid (zid/tla)
    feasibility.ts    // predhodna preverba izvedljivosti
    preference.ts     // A/B učenje uteži + konvergenca
  /constraints
    brief.ts          // definicija projekta (prostor, program, mokri/zunanji zid)
    zones.ts          // no-go cone, pripenjanje
  /components          // React UI
    InspectorO1.tsx
    ConfiguratorO2.tsx
    Plan2D.tsx  Iso3D.tsx
    LearningAB.tsx
    Trace.tsx          // LOG sklepanja (steklena škatla)
  /ifc                 // (kasneje) ifcopenshell-adapter → strukturirana opažanja
  App.tsx
/docs
  ARCHITECTURE.md      // trije diagrami (prekopiraj iz pogovora)
  HANDOFF.md           // ta dokument
```

---

## 5. Definicija MVP1 (kdaj je KONEC)

MVP1 = **cel zankasti tok za eno sobo (WC)**, zgrajen na envelope + priklopnih točkah, z:

1. **O1 + O2 + O5** delujoče (postavitev + routing od priklopov).
2. **O9 indukcija**: pravila NISO več hardcodana — AI jih izlušči iz referenc v Envelope obliki. **Test:** zamenjaš nabor referenc → pravila in generacija se spremenijo, **brez urejanja kode**. Z vmesnim pregledom/urejanjem izluščenih pravil (steklena škatla).
3. **Tri merilne osi** (ločene, ker so ločljive):
   - (a) **kakovost indukcije** — train/test holdout: nauči na delu referenc, preveri na zadržanih.
   - (b) **posplošitev** — nov brief, ki ga ekspert prepozna kot "tako bi začel".
   - (c) **donos preferenc** — ocena/sprejemljivost pred in po N A/B primerjavah.
4. **Trajnost** — knjižnica, pravila, projekti se shranijo (localStorage zdaj; backend/Mongo kasneje po obstoječem Hetzner vzorcu).

3D extrude je opcijski. Vogalna postavitev je odložena (ni MVP blocker).

---

## 6. Naloge za Claude Code (po vrsti, z merili)

**T1 — Repo + git + modularizacija.**
Init repo (`zorkojaka`), git od prve. Porti prototip v strukturo iz §4. *Merilo:* aplikacija teče identično kot prototip, commitano, engine ločen od UI.

**T2 — O5 routing.**
Trase od **dejanske priklopne točke** (ne centra) do mokrega zidu/jaška. Politika `routesTo: zid|tla` + projektna politika (so tla dovoljena na tej plošči?). Vizualiziraj trase z dolžinami; označi križanja po tleh. *Merilo:* dolžina odtoka iz priklopa; premik priklopa/mokrega zidu spremeni trase; talna trasa pravilno označena/blokirana po politiki.

**T3 — Predhodna izvedljivost.**
Pred generacijo: ali trda jedra + program + cone sploh gredo v prostor? Če ne → javi razlog, ne lupaj v prazno. *Merilo:* nemogoč brief vrne jasen razlog v < instant.

**T4 — Konvergenca A/B.**
Zazna umiritev uteži (stop pogoj) poleg ročnega "dovolj". *Merilo:* po N doslednih primerjavah javi konvergenco.

**T5 — O9 indukcija (glavni oreh).**
Vhod: nabor strukturiranih referenc (zdaj tekst/JSON; kasneje IFC). AI klic izlušči `Envelope` za vsak parameter + `conf` iz variance + `scope`. Vmesni pregled/urejanje pravil. *Merilo:* zamenjava nabora referenc spremeni generacijo brez spremembe kode; nizka varianca → trdo, visoka → mehko; vsaka odločitev v razlagi cita izluščeno pravilo + referenco.
> Opomba: v prototipu/frontu lahko AI klic teče direktno (Anthropic API). V produkciji prek backenda. Vhod je VEDNO strukturiran (NE PDF).

**T6 — Tri merilne osi (§5.3).** *Merilo:* vsaka os ima številko; (a) na holdout setu.

**T7 — Trajnost.** localStorage → kasneje backend (Hetzner + Mongo, obstoječ GitHub Actions auto-deploy vzorec). *Merilo:* zapri/odpri = stanje ostane.

**Po MVP:** IFC adapter (ifcopenshell → strukturirana opažanja → gručenje → knjižnica elementov); vogalna postavitev; **oreh 2 (razporeditev sob)** kot druga instanca istega pogona.

---

## 7. Zaklenjene odločitve (guardrails — NE spreminjati brez razloga)

- **Engine je deterministični** (sampling/optimizacija + repair). NE nevronska mreža za postavitev — to je rešen OR problem in mora ostati razlagljiv.
- **Pravila so PODATKI (Envelope), ne koda.** Indukcija jih napolni; uporabnik/engine jih ureja.
- **Trdo vs mehko:** trdo jedro nikoli kršeno; mehki halo se sme upogniti s kaznijo. Lok vrat = trdo. Realnost (vogalno prekrivanje) je mehko, ne izjema.
- **Orientacija izhaja iz priklopov**, ne ročno. Priklop znotraj odtisa ne vpliva na postavitev, le na servisno stran.
- **Vir "user" = trda lastnost.** Kar uporabnik vnese, povozi default/ifc.
- **Vmesnik omejitev** (no-go cone, pripeti elementi) je isti, ne glede na to, ali ga polni uporabnik ali zgornji engine za razporeditve sob.
- **AI samo za indukcijo + razlago.** Geometrija je klasična.
- **Engine domensko agnostičen** (enota+prostor parametrizirana), da služi tudi orehu 2.
- **Steklena škatla:** vsak korak ima viden vmesni rezultat; zavrnjeni kandidati se kažejo z razlogom.

---

## 8. Tehnološki sklad in deploy

- **Front:** React + Vite. UI iz §4 `/components`.
- **Engine:** čist TypeScript, brez UI odvisnosti, pokrit s testi (geometrija, hard/soft, orientacija).
- **AI klici:** Anthropic API; v prototipu lahko iz fronta, v produkciji prek lahkega backenda.
- **IFC (kasneje):** Python servis z `ifcopenshell`, izvoz strukturiranega grafa (JSON) — front/engine bereta to, nikoli PDF.
- **Deploy:** GitHub Actions auto-deploy na Hetzner VPS (obstoječ vzorec, isti kot AIntel). Veje per oreh.
- **Git od prve naloge.** Vsak oreh svoja veja → PR → main.

---

## 9. Prvi koraki za Claude Code (takoj)

1. `git init`, scaffold Vite+React+TS, struktura iz §4, prvi commit.
2. Porti `layout_engine_steps.jsx`: izloči engine v `/engine` in `/elements` kot čist TS; UI v `/components`. Potrdi identično vedenje.
3. Prekopiraj diagrame iz pogovora v `docs/ARCHITECTURE.md`.
4. Začni **T2 (O5 routing)** na veji `oreh/o5-routing`.
5. Nato **T5 (O9 indukcija)** — glavni oreh do MVP.

---

*Konec predaje. Vse zaklenjene odločitve in podatkovni modeli zgoraj so dovolj, da se MVP izpelje brez ponovnega razlaganja. Ob dvomu: engine deterministični, pravila kot envelope-podatki, AI le za indukcijo in razlago, steklena škatla povsod.*
