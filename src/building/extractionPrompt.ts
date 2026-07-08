/**
 * Prompt za AI-ekstrakcijo referenčnega načrta. Demo tok: uporabnik da
 * Claudu sliko/PDF načrta + ta prompt, dobljeni JSON prilepi v aplikacijo
 * (korak Reference). Človek nato preveri mere — AI predlaga, človek potrdi.
 */

export const EXTRACTION_PROMPT = `Si asistent za ekstrakcijo tlorisov. Priložen je tloris etaže.
Iz njega izlušči strukturiran opis v natančno tem JSON formatu (enote: milimetri,
izhodišče zgoraj levo, y narašča navzdol). Vrni SAMO JSON, brez razlage.

{
  "id": "kratka-oznaka",
  "name": "opisno ime načrta",
  "outline": { "x": 0, "y": 0, "w": <širina stavbe mm>, "h": <globina stavbe mm> },
  "entrances": [{ "side": "N|S|E|W", "offset": <mm od levega/zgornjega roba stene> }],
  "rooms": [
    {
      "id": "unikaten-id",
      "type": "office|wc|corridor|storage|tech|other",
      "name": "ime sobe iz načrta",
      "rect": { "x": <mm>, "y": <mm>, "w": <mm>, "h": <mm> },
      "zone": "<opcijsko: cona čistosti / namembnost>"
    }
  ],
  "connections": [{ "a": "<roomId>", "b": "<roomId ali 'outside'>" }],
  "layers": [{ "id": "arch", "kind": "architecture" }],
  "flows": [{ "id": "ljudje", "kind": "people", "path": ["<roomId>", "..."] }],
  "source": "ai-extracted"
}

Pravila ekstrakcije:
- Sobe poenostavi na pravokotnike (najboljši očrtani pravokotnik).
- Hodnik MORA obstajati (type "corridor"); če je L-oblike, ga razdeli na več pravokotnikov tipa corridor.
- Merilo: če je na načrtu kotirana mera, jo uporabi za umeritev; sicer oceni iz standardne širine vrat (900 mm).
- "connections" izpolni iz vrat: vsaka vrata = ena povezava; vhod v stavbo = povezava z "outside".
- Če vidiš oznake con (čisto/nečisto, GMP razredi), jih zapiši v "zone".
- Negotove mere označi tako, da v "name" dodaš " (?)" — človek jih bo preveril.`;
