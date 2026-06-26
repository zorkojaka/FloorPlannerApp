# Training references for induction

The current O9 parser accepts structured observations, not full plan geometry.
Paste a JSON array into **Šolanje → Reference JSON** and click **Izlušči pravila**.

Current supported observation format:

```json
{
  "ref": "unique-reference-id",
  "roomType": "classic-bathroom",
  "scope": "room-type",
  "elementKey": "toilet",
  "parameter": "clearance-front",
  "value": 610,
  "source": "https://example.com/source",
  "note": "short explanation"
}
```

Required fields today:
- `ref`: unique source/example id.
- `elementKey`: currently `toilet` or `sink`.
- `parameter`: currently only `clearance-front`.
- `value`: millimetres.

Optional but recommended:
- `roomType`: separates classic, compact, accessible, commercial, etc.
- `scope`: `room-type` for room-specific rules, `global` for broader fixture defaults.
- `source`: public URL, project id, or internal drawing id.
- `note`: how the value was extracted.

Starter file:
- `data/training/classic-bathrooms-clearance-front.json`

Important: accessible references are intentionally included as separate examples. Do not mix them into the classic-only set unless you want the learned envelope to become much larger and softer.

## Good source types

- Public layout/dimension libraries for typical residential bathroom plans.
- Planning guides such as NKBA bathroom planning guidelines.
- Accessibility standards such as ADA only when training an accessible-room scope.
- Internal validated project drawings, once available.

## Later input formats

The next useful format is a full plan object: room dimensions, wall/opening positions, fixtures with x/y/w/d/z/h, and extracted measurements. That can coexist with this observation format, but it needs a converter step before induction.
