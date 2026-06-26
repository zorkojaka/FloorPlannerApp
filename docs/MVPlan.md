# MVPlan

## Cilj prototipa

Zgraditi delujoc prototip hierarhicnega layout engina:

1. Projekt/etaza ima dano skupno kvadraturo in osnovne omejitve.
2. Engine razporedi sobe: WC, pisarne in hodnike.
3. Vsaka soba nato sama razporedi svojo opremo/pohistvo.
4. Za vsak tip sobe lahko uporabnik nalozi IFC referencne nacrte.
5. Sistem iz IFC nacrtov prepozna prostore, stene, vrata, okna in elemente, iz njih izracuna opazovanja ter inducira pravila.
6. Vsa pravila ostanejo kot podatki: envelope `core / halo / sat / conf`, engine pa ostane deterministicen.

Prototip ni namenjen popolni BIM natančnosti. Namen je dokazati pot:

```text
IFC reference -> strukturirani podatki -> opazovanja -> envelope pravila -> generiranje novih postavitev
```

## Zaklenjena arhitektura

- Engine je deterministicen.
- Pravila so podatki, ne hardcodana logika.
- Trda pravila zavrnejo kandidata.
- Mehka pravila kandidata kaznujejo.
- AI je dovoljen samo za indukcijo in razlago, ne za geometrijsko odlocanje.
- Vmesnik mora biti steklena skatla: uporabnik vidi pravila, vire in razloge.

## Koncni MVP scenarij

Uporabnik:

1. Vnese okvir etaze ali skupno kvadraturo.
2. Vnese program, npr. 1 WC, 4 pisarne, hodnik.
3. Za WC nalozi IFC reference WC prostorov.
4. Za pisarne nalozi IFC reference pisarn.
5. Sistem iz IFC prepozna elemente in jih doda v urejevalno knjiznico.
6. Sistem iz IFC izracuna opazovanja in inducira pravila za vsak `roomType`.
7. Uporabnik pregleda/popravi elemente in pravila.
8. Engine generira etazo: sobe + hodniki.
9. Uporabnik v A/B vmesnem koraku izbira boljse razporeditve sob.
10. Sistem iz izbire uci preference za etazo in izpostavi nekaj najboljsih kandidatov.
11. Izbrani kandidati gredo naprej v notranjo razporeditev sob.
12. Vsaka soba generira notranjo postavitev.
13. Uporabnik vidi tloris, naris/3D in razlago pravil.

## Podatkovni model

Hierarhija:

```text
ProjectBrief
  ProjectBoundary
  RoomProgram[]
  TrainingSet[]

FloorLayout
  PlacedRoom[]
    RoomConstraints
    PlacedElement[]
```

Osnovni tipi sob:

- `wc`
- `office`
- `corridor`

Kasneje:

- meeting room
- lab
- changing room
- storage
- production room
- technical room

## Faza 1: osnovni model projekta

Naloge:

1. Dodaj `RoomType`, `RoomProgram`, `ProjectBrief`.
2. Dodaj privzete room type definicije za WC, pisarno in hodnik.
3. Dodaj funkcije za oceno potrebne povrsine iz programa.
4. Dodaj teste za oceno kvadrature in validacijo programa.

Merilo uspeha:

- Program `2 office + 1 wc + corridor` vrne konkretno oceno kvadrature.
- Model ne posega v obstojeci generator ene sobe.

## Faza 2: soba kot element

Naloge:

1. Dodaj `RoomElement`/`PlacedRoom`.
2. Soba ima footprint, vrata, tip sobe, zahteve in notranji program.
3. Hodnik postane povezovalni element, ne navadna soba s pohistvom.
4. Pripravi adapter: `PlacedRoom -> RoomConstraints`.

Merilo uspeha:

- Lahko ustvarimo tri sobe in jih podamo istemu podatkovnemu modelu.
- WC soba se lahko prevede v obstojece `RoomConstraints`.

## Faza 3: rocni generator etaze

Naloge:

1. Vhod: kvadratura/okvir, stevilo WC-jev, pisarn, hodnik.
2. Preprost deterministicen slicing:
   - hodnik kot hrbtenica,
   - pisarne ob zunanjem robu,
   - WC blizu mokrega/tehnicnega pasu.
3. Izris tlorisa etaze.

Merilo uspeha:

- Engine postavi vsaj 1 WC, 2 pisarni in hodnik v dano kvadraturo.
- Vse sobe imajo vrata na hodnik.

## Faza 4: notranji engine po sobah

Pred to fazo mora obstajati vmesni uporabniski izbor razporeditve sob. To je isti vzorec kot pri trenutnem A/B izboru notranjih postavitev, samo da so kandidati celotne etaze:

```text
FloorLayout A vs FloorLayout B -> uporabnik izbere boljsega -> learned floor weights
```

Ucenje preferenc na nivoju etaze naj zajame:

- krajsi hodniki,
- manj izgubljene povrsine,
- WC blizu mokrega/tehnicnega pasu,
- pisarne ob fasadi/oknih,
- manj križanj poti,
- bolj logicne skupine sob,
- stabilnost trenutnega prvaka.

Sele ko uporabnik izbere nekaj dobrih kandidatov etaze, engine za vsako sobo izvede notranjo razporeditev.

Naloge:

1. Za `wc` uporabi obstojeci room engine.
2. Dodaj osnovno knjiznico za pisarno:
   - miza,
   - stol,
   - omara.
3. Dodaj office pravila:
   - pot vrata -> stol/miza,
   - clearance za stol,
   - miza blizu okna kot mehko pravilo.
4. Hodnik preverja sirino in povezljivost.

Merilo uspeha:

- Vsaka WC soba dobi WC + umivalnik.
- Vsaka pisarna dobi mizo + stol + opcijsko omaro.
- Hodnik ostane prehoden.

## Faza 5: IFC importer

Naloge:

1. Uporabi IfcOpenShell za offline uvoz IFC.
2. Preberi:
   - `IfcSpace`,
   - `IfcWall`,
   - `IfcDoor`,
   - `IfcWindow`,
   - `IfcFurniture`,
   - `IfcSanitaryTerminal`,
   - druge terminale/opremo po potrebi.
3. Normaliziraj v JSON:
   - sobe,
   - odprtine,
   - elementi,
   - dimenzije,
   - pozicije,
   - izvorni IFC GUID.
4. Dodaj testni fixture JSON, tudi ce pravega IFC se ni.

Merilo uspeha:

- En IFC ali fixture se pretvori v `NormalizedPlan`.
- Prepoznani elementi so vidni in popravljivi.

## Faza 6: pregled in popravljanje elementov

Naloge:

1. UI seznam prepoznanih IFC elementov.
2. Uporabnik lahko popravi:
   - kategorijo,
   - ime,
   - dimenzije,
   - ali element vstopi v knjiznico.
3. Popravljeni elementi se shranijo kot del `ElementLibrary`.

Merilo uspeha:

- Iz IFC/fixture elementa nastane urejevalni element v knjiznici.

## Faza 7: IFC -> opazovanja

Naloge:

1. Iz normaliziranih referenc izracunaj meritve.
2. Za WC:
   - `clearance-front`,
   - `distance-to-wet-wall`,
   - `distance-to-door`,
   - `room-width`,
   - `room-depth`.
3. Za office:
   - `desk-clearance-back`,
   - `desk-distance-to-window`,
   - `chair-clearance`,
   - `area-per-workplace`.
4. Za corridor:
   - `corridor-width`,
   - `door-access`,
   - `dead-end-length`.

Merilo uspeha:

- Iz enega referencnega nacrta dobimo seznam observation JSON zapisov.

## Faza 8: razsirjena indukcija

Naloge:

1. Razsiri `InductionParameter` iz enega parametra na vec parametrov.
2. Grupiranje po `roomType`, `elementKey`, `parameter`, `scope`.
3. Holdout porocilo za vsak tip sobe.
4. UI prikaze pravila po sobah.

Merilo uspeha:

- Zamenjava referenc za office spremeni office pravila, brez spremembe kode.
- Zamenjava referenc za WC ne spremeni office pravil.

## Faza 9: integriran demo

Naloge:

1. Projektni workflow:
   - program prostorov,
   - training seti,
   - generiranje etaze,
   - A/B izbor kandidatov etaze,
   - generiranje notranjosti sob.
2. Prikaz:
   - etaža,
   - klik na sobo,
   - notranji tloris/naris/3D za izbrano sobo.
3. Razlaga:
   - katera pravila so uporabljena,
   - kateri vir jih je naucil,
   - kateri kandidati so padli.

Merilo uspeha:

- Na enem zaslonu vidimo etazo z WC, pisarnami in hodnikom.
- Vidimo dva kandidata etaze hkrati in lahko izberemo boljsi tloris sob.
- Klik na pisarno/WC pokaze pohistvo/opremo znotraj.
- Pravila za WC in office prihajajo iz locenih referenc.

## Priporocen vrstni red izvedbe

1. Osnovni model projekta in tipov sob.
2. Testi za program in kvadraturo.
3. Rocni generator etaze.
4. Izris etaze.
5. A/B izbor kandidatov etaze in ucenje preferenc za floor layout.
6. Adapter soba -> obstojeci room engine.
7. Office elementi in office notranji generator.
8. IFC normalized fixture format.
9. IFC importer prototip ali fixture converter.
10. Review UI za prepoznane elemente.
11. IFC -> observations.
12. Razsirjena indukcija.
13. Integriran demo.

## Najvecja tveganja

- IFC datoteke bodo lahko nekonsistentne po imenih, kategorijah in geometriji.
- Prepoznavanje pohistva ne sme biti magicno; uporabnik mora imeti review/popravek.
- Dostopne kopalnice in klasicne kopalnice ne smejo biti mesane v isti rule-set, razen ce to uporabnik zeli.
- Sobni generator in notranji generator morata ostati locena, sicer postane sistem tezko razlozljiv.

## Trenutni naslednji korak

Implementirati fazo 1: model projekta, tipe sob in osnovno oceno kvadrature.

## Izvedeno

- Dodan osnovni projektni model: `ProjectBrief`, `RoomProgram`, `RoomType`.
- Dodani tipi sob: WC, pisarna, hodnik.
- Dodana ocena kvadrature programa.
- Dodan prvi deterministicen strip generator etaže: hodnik + sobe ob hodniku.
- Dodan vmesni A/B izbor kandidatov etaže.
- Projektni nivo podpira več glavnih vhodov v etažo; prvi vhod določa glavno smer hodnika, vsi vhodi so izrisani na tlorisu.
- Hodniki imajo politiko širine: minimalna širina, širina glavnega hodnika in širina stranskih priključkov. Normalized IFC observations podpirajo ločeno indukcijo `corridor-width-main` in `corridor-width-side`.
- Dodani osnovni pisarniški elementi: pisalna miza, pisarniški stol, omara.
- Dodan `NormalizedIfcPlan` fixture format in pretvorba v induction observations.
- Dodan dokaz za projektno indukcijo strategije etaže: normalizirane reference izluščijo profil (`centralni WC` ali `razpršeni WC`), isti bazen kandidatov pa se po profilu rangira drugače. S tem preverimo, da reference spreminjajo vedenje brez spremembe generatorja.
