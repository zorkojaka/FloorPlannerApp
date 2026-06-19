# Instalacije — medij priklopa + daljinec plasti

> Veja `feat/instalacije-daljinec`. Steklena škatla: pravila se prikazujejo in
> razlagajo. Komentarji slovensko, koda angleško.

## Medij priklopa (COMMIT 1)

Medij priklopa = `Connection.type` (`water-out` voda-odvod, `water-in` voda-dovod,
`electric` elektrika, `vent` zrak). Vsak priklop ima še **višino `z`** (mm od tal),
nastavljivo; privzeto na sredini višine elementa (`connectionZ` v
`src/elements/model.ts`).

Vsak medij ima **profil trasiranja** (`MEDIA_PROFILE`) — fizika, trd + global, se
NE uči:

| medij | gravity | sme čez ovire | pravilo |
|---|---|---|---|
| voda-odvod | da | ne | gravitacijski: mora padati; ne čez odprtino vrat/prag; rabi vertikalo (jašek) v dosegu |
| voda-dovod | ne | da | tlačni: prosta pot, brez padca |
| elektrika | ne | da | skoraj prosta pot |
| zrak | ne | da | prosta pot, večji presek (polni model odložen) |

Routing (`routeServices`) oceni vsako traso proti profilu medija (`mediumOk`,
`mediumNote`). Evaluator (`evalPlace`) uveljavi kot **trdo veljavnost**:
gravitacijski odvod, čigar ravna trasa do mokrega zidu seka odprtino vrat
(`door.pass`/`door.foot`), naredi razporeditev neveljavno z razlago.

Steklena škatla: pravilo medija je vidno **že pri urejanju priklopa** (korak 1),
razlog ob zavrnitvi in potrditev ob veljavni traso sta v desnem stolpcu (O5).

### ODLOŽENO (regulirana domena)
Polni **naklonski model** gravitacijskega odvoda — troši višino (dolžina × naklon),
omejena dolžina jaška, min. padec — NI implementiran. MVP preveri le: ne čez vrata +
vertikala (mokri zid) v dosegu. Označeno v kodi (`model.ts`, `evaluator.ts`).

## Daljinec — plasti prikaza (COMMIT 2)

Ob strani načrta je **daljinec**: checkboxi za vklop/izklop plasti izrisa,
grupirani po družinah (group checkbox vklopi/izklopi celo družino, posamezni
sloji ostanejo neodvisni):

- **Prostor:** stene, oprema, vrata, okna
- **Pravila:** jedra, halo, poti, človeški kvadri
- **Instalacije:** voda-odvod, voda-dovod, elektrika, zrak — vsak SVOJA BARVA

**Privzeto (ob odprtju):** vklopljeni samo stene, oprema, vrata, okna. Vse ostalo
izklopljeno; uporabnik prižge, kar hoče videti (npr. le voda-odvod + oprema).

**KLJUČNO:** daljinec vpliva SAMO na izris — ne na engine, pravila ne rezultat.
Routing/poti se vedno izračunajo; daljinec jih le (ne) nariše.

Napeljava (vse 4 medije) se nariše v VSEH treh pogledih, ko je sloj vklopljen:
- **tloris:** trasa po medijevi barvi
- **naris:** PADEC odvoda (vertikala od višine priklopa navzdol) — tloris padca ne pokaže
- **3D:** trasa kot linija po barvi (+ vertikala padca za odvod)
