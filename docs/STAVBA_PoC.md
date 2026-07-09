# Stavba · PoC — gnezdenje (Oreh 2)

> **⚠️ UPOKOJENO (2026-07-09).** Koda te demo poti (`src/building/`, App način
> »Stavba PoC«) je odstranjena. Vsa vrednost je prenesena na **project hrbtenico**
> (`src/project/` + `src/ifc/`): uvoz IFC/AI → indukcija strategije in con →
> generator → A/B izostritev → oprema cele etaže → plasti (prostori/cone/tokovi).
> Stavba (Oreh 2) je zdaj faza »projekt« znotraj glavnega engine-a. Ta dokument
> ostaja kot zapis izvornega koncepta in večplastne sheme, ki je usmerila project linijo.

> Demo potrditev koncepta: iz referenčnih načrtov (pisarne + WC + hodniki) se
> inducirajo pravila, deterministični generator nato postavlja sobe v **drugačno**
> stavbo (druga kvadratura, drug vhod, druga števila sob), uporabnik z A/B
> izbirami izostri rezultat do izhodišča za ročno delo.

## Zakaj

Testni poligon za pravi cilj: večplastni načrti proizvodnih obratov → prenos
znanja na nove zahteve. Zato je referenčna shema (`src/building/schema.ts`) od
prvega dne večplastna: `layers`, `zones`, `flows` — WC/pisarne PoC jih polni
minimalno, prenos na proizvodnjo ne zahteva spremembe sheme.

## Tok (koraki v UI)

| Korak | Kaj se zgodi | Kje v kodi |
|---|---|---|
| A Reference | 6 sintetičnih načrtov = "resnica"; + uvoz AI-ekstrahiranega JSON | `references.ts`, `extractionPrompt.ts` |
| B Pravila | indukcija: min→jedro, mediana→halo, p90→nasičenje, zaupanje iz variance; sosedstva 100 %→trdo | `induction.ts` |
| C Naloga | brief: mere stavbe, vhod, št. pisarn/WC; trda izvedljivost vnaprej | `generator.ts` (`checkBriefFeasibility`) |
| D Kandidati | deterministični generator (hodnik od vhoda, sobe obojestransko, WC ob vhodu, zaledna cona) + razložljiva ocena | `generator.ts`, `evaluator.ts` |
| E A/B | izbire premikajo uteži 4 signalov → konvergenca → izhodišče; izbrani kandidat lahko postane nova referenca (zanka učenja) | `preference.ts` |

## Ključne demo poante

1. **AI ne riše** — bere načrte (ekstrakcijski prompt) in inducira pravila;
   geometrijo postavlja deterministični engine → vsaka ocena razložljiva.
2. **Trdo vs mehko**: trda jedra (prekrivanja, dostop s hodnika, minimalne
   kvadrature, širina hodnika) se nikoli ne kršijo; mehko (halo) se upogne s
   kaznijo. Neizvedljiva naloga → jasno sporočilo, ne ugibanje.
3. **Malo referenc je dovolj**: 5–10 načrtov → statistične ovojnice, ne ML.
   Varianca referenc = zaupanje pravila.
4. **Zanka učenja**: potrjeni kandidat → nova referenca → ostrejša pravila.
5. **Gnezdenje**: vsaka postavljena soba je nov "prostor" za obstoječi engine
   opreme-v-sobi (Oreh 1) — isti pogon, dva nivoja.

## AI-ekstrakcija načrtov

Prompt v `src/building/extractionPrompt.ts` (gumb "Kopiraj" v koraku A):
sliki/PDF-ju načrta priložiš prompt, Claude vrne strukturiran JSON po shemi,
človek preveri mere, prilepi v aplikacijo. Naslednji korak po PoC: neposredna
integracija (Claude API vision) + verifikacijski overlay na izvorni sliki.
