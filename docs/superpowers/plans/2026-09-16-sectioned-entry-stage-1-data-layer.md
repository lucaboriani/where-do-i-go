# Sectioned Entry — Stage 1: the data layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's own loop (CLAUDE.md "How work is done here") is mandatory: `test-specialist` writes the failing test and shows it fail; `solid-specialist` implements the Pod/RDF code; `fullstack-solid-reviewer` reviews the diff before the task is done. Both, always.

**Goal:** Move the entry content model from a single `schema:articleBody` blob + flat photo list to an ordered list of `dy:Section`s (each with optional text and 0–2 photos), across the vocabulary, the Zod schema, the reader, the serialiser, the index derivation, the fixtures and the seed — so a sectioned entry round-trips through the Pod. The public page (Stage 2) and the studio editor (Stage 3) are separate plans that build on this one.

**Architecture:** Sections are fragments under the entry resource (`#section-1`, `#section-1-photo-1`), linked from `<#it>` by `schema:hasPart`, carrying `schema:text` and owning their photos via `schema:image`; order is `dy:sortOrder` on both. The only new vocabulary term is the class `dy:Section`; `schema:hasPart` and `schema:text` are existing schema.org predicates newly added to `lib/vocab.ts`. The reader gains `sectionsOf` (mirroring `photosOf`, reusing it for a section's nested photos); the serialiser gains `sectionQuads` (sharing a new `imageObjectQuads` helper with `photoQuads`). To keep the tree green at every commit while the page and editor still read the old fields, `Entry` **gains** `sections` but **keeps** `articleBody` and `photos` as optional legacy fields; Stage 3 removes them once nothing reads them.

**Tech Stack:** TypeScript, Zod, n3 (Turtle read/write), Vitest + MSW, Community Solid Server (integration), `tsx` scripts (`validate:fixtures`, `check:vocab`, `seed-dev-pod`).

**Spec:** `docs/superpowers/specs/2026-09-15-sectioned-entry-design.md` (RDF authority: `docs/data-model.md`). This is Stage 1 of 3 — see "Staging" below.

## Global Constraints

Every task's requirements implicitly include this section. Values are from the spec, `docs/data-model.md`, and CLAUDE.md.

- **Node 22 before any check.** The shell defaults to Node 20; run `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` and confirm `node -v` prints `v22.x`. A green result on Node 20 proves less than it looks.
- **No live Pod, no migration.** The `dy:` namespace is still `https://example.org/ns/traveldiary#` (the permanent-identifier blocker holds). Only disposable local CSS data exists, so the schema-version bump needs no data migration — but the branch must still be green at every commit (definition of done).
- **The only new term is `dy:Section`** (a class). `schema:hasPart` and `schema:text` are existing schema.org predicates; add them to `lib/vocab.ts`'s `SCHEMA` object. All IRIs come from `lib/vocab.ts` — no predicate string literals elsewhere (enforced by `no-restricted-syntax`).
- **Fragments only, never blank nodes.** Sections are `#section-<n>`; a section's photos are `#section-<n>-photo-<m>`. `validate:fixtures` rejects blank nodes.
- **Explicit datatypes.** `dy:sortOrder` is `xsd:integer`; timestamps are `xsd:dateTime` with a UTC offset; coordinates `xsd:decimal`. `schema:text` is a language-tagged literal (human prose); a slug/code/media-type stays plain.
- **Language-tag human-readable literals** (`schema:text`, `schema:caption`, `schema:headline`, place name). Codes and base64 stay plain.
- **Validate on read.** Every read returns a typed object or a structured `PodError` via Zod — never a throw to the caller, never indexing raw triples. A section failing its refine is a `kind: "shape"` read error.
- **`dy:schemaVersion` is checked on every top-level read** and **written from the code's own constant**, never echoed from the parsed resource. This stage bumps `SCHEMA_VERSION` 1 → 2.
- **Compare RDF by graph isomorphism, never bytes** (`@/test/graph`'s `graphEquals`/`triples`). Turtle has no canonical form.
- **The index read model does not change shape.** `IndexEntry` is untouched; only the *derivation* of its `dy:thumbnail` moves from "entry's first photo" to "first section's first photo". This is what keeps Stage 2's map/timeline (phase-7 Tasks 4–9) unaffected.
- **Function-length bounds** (excl. comments/blank): lib/util ≤ 50 tend / 80 hard; test file ≤ 600 tend / 1000 hard. Comments ≤ 3 lines tend / 6 hard in production; longer reasoning goes to a sibling `notes.md` with a `// one line; see ./notes.md#anchor` pointer.

## Staging

- **Stage 1 (this plan): the data layer.** vocab, schema, read, serialise, index derivation, fixtures, seed. Ships a sectioned entry that round-trips. Legacy `articleBody`/`photos` kept on `Entry` (optional) so page/editor still compile.
- **Stage 2: the public entry page.** Renders sections with the phase-7 look (`.display` masthead, `.meta-row`, per-section prose/photo/`.pair`, `SiteFooter`). Depends on `Entry.sections` from Stage 1. Superseded phase-7 Task 3.
- **Stage 3: the studio editor + cleanup.** Section authoring (add/remove/reorder, 0–2 photos per section), draft key `v2`→`v3`, then **remove** `articleBody`/`photos` from `Entry` and the now-dead read/serialise/page code.

Stages 2 and 3 are independent of each other; both depend on Stage 1. Each is written as its own plan when it is picked up.

---

### Task 1: The vocabulary — `dy:Section`, `schema:hasPart`, `schema:text`

Add the one new class and the two existing schema.org predicates to `lib/vocab.ts` and record `dy:Section` in the normative data model. `check:vocab` cross-checks `dy:` terms in both directions; `schema:` terms are not cross-checked but belong in the `SCHEMA` object so no predicate string literal appears elsewhere.

**Files:**
- Modify: `lib/vocab.ts` (`DY_CLASS` gains `Section`; `SCHEMA` gains `hasPart`, `text`)
- Modify: `docs/data-model.md` §3 "Classes" (add `dy:Section`)

**Interfaces:**
- Consumes: nothing.
- Produces: `DY_CLASS.Section` (`= dy("Section")`), `SCHEMA.hasPart` (`= schema("hasPart")`), `SCHEMA.text` (`= schema("text")`). Consumed by Tasks 2–5.

- [ ] **Step 1: Add `dy:Section` to the data model first (the normative source)**

In `docs/data-model.md` §3, under `### Classes` (the bulleted list currently ending at `dy:TravelMode`), add one bullet after `dy:Entry`:

```
- `dy:Section` — an ordered part of an entry; its own text and up to two photos
```

- [ ] **Step 2: Run `check:vocab` and watch it fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; npm run check:vocab`
Expected: FAIL — "In the data model but NOT exported from lib/vocab.ts" names `Section` (the doc now mentions `dy:Section`; vocab does not export it).

- [ ] **Step 3: Add the terms to `lib/vocab.ts`**

In `DY_CLASS` (the `dy:` classes object), add after `Entry`:

```ts
  Section: dy("Section"),
```

In `SCHEMA` (the single schema.org object), add alongside the other predicates (e.g. after `articleBody`):

```ts
  hasPart: schema("hasPart"),
  text: schema("text"),
```

- [ ] **Step 4: Run `check:vocab` and the vocab guardrail**

Run: `npm run check:vocab && npx vitest run test/guardrails.test.ts`
Expected: PASS. `dy:Section` now appears in both the doc and the export; `schema:hasPart`/`schema:text` are exported (not cross-checked, but present).

- [ ] **Step 5: Commit**

```bash
git add lib/vocab.ts docs/data-model.md
git commit -m "Vocab: dy:Section, and schema:hasPart/schema:text for the sectioned entry"
```

---

### Task 2: The `Section` Zod schema and reading sections

Add the `Section` schema, give `Entry` a `sections` array (keeping `articleBody`/`photos` as legacy shim), and teach `readEntry` to parse `schema:hasPart` sections — each with optional `schema:text`, nested `schema:image` photos (reusing `photosOf`), and `dy:sortOrder`, sorted. A section that satisfies neither "has text" nor "has ≥1 photo" fails its refine as a structured `shape` error.

**Files:**
- Modify: `lib/pod/schema.ts` (add `Section`; `Entry` gains `sections`)
- Modify: `lib/pod/read.ts` (add `sectionsOf`; `readEntry` reads `sections`)
- Modify test: `lib/pod/read.test.ts` (add a `readEntry` sections `describe` block)
- Modify (keep `tsc` green — `sections` is required): every existing `Entry` builder gets `sections`. Test builders get `sections: []`: `lib/pod/entry-model.test.ts`, `lib/pod/index-model.test.ts`, `hooks/studio/use-entry-form.test.ts`, `hooks/studio/use-entry-save.test.ts`. Production `hooks/studio/use-entry-save.ts` must **carry `existing?.sections ?? []` forward** (NOT a bare `sections: []` — with Task 4's index thumbnail sourced from `entry.sections`, a bare `[]` makes any studio save silently wipe an existing entry's sections and blank its thumbnail). Stage 3 replaces this carry-forward with real section-building. (Corrected during Task 5.)

**Interfaces:**
- Consumes: `SCHEMA.hasPart`, `SCHEMA.text` (Task 1); existing `Photo`, `LangText`, `photosOf`, `langText`, `integer`, `viewOf`, `take`, `guard`, `validate`.
- Produces: `Section` (`z.infer` type `Section`), `Entry.sections: Section[]`, and `sectionsOf(quads: Quad[], sectionIris: string[], url: string): Result<RawSection[]>` (raw objects validated in the single `Entry` pass, exactly as `photosOf` returns raw photos). Consumed by Tasks 3–5 and Stage 2.

- [ ] **Step 1: Write the failing read tests**

Append to `lib/pod/read.test.ts`. Build sectioned Turtle self-contained (not from the not-yet-sectioned fixture), and interpolate `SCHEMA_VERSION` so these survive the Task-5 bump. Add the import `import { SCHEMA_VERSION } from "@/lib/vocab";` at the top of the file.

```ts
describe("readEntry — sections", () => {
  const sectioned = (body: string) => `
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix schema:  <https://schema.org/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dy:      <https://example.org/ns/traveldiary#> .
<#it> a schema:BlogPosting, dy:Entry ;
    schema:headline "T"@en ;
    dcterms:creator <https://me.solidcommunity.net/profile/card#me> ;
    dy:schemaVersion ${SCHEMA_VERSION} ;
    dy:slug "2026-03-29-arrival" ;
    dy:status dy:Published ;
${body}
`;

  it("reads sections in dy:sortOrder, not document order", async () => {
    servePod({
      [URLS.entry]: sectioned(`
    schema:hasPart <#section-2>, <#section-1> .
<#section-1> a dy:Section ; dy:sortOrder 1 ; schema:text "first"@en .
<#section-2> a dy:Section ; dy:sortOrder 2 ; schema:text "second"@en .`),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sections.map((s) => s.text?.value)).toEqual(["first", "second"]);
  });

  it("reads a two-photo section, photos ordered by sortOrder", async () => {
    servePod({
      [URLS.entry]: sectioned(`
    schema:hasPart <#section-1> .
<#section-1> a dy:Section ; dy:sortOrder 1 ;
    schema:image <#section-1-photo-2>, <#section-1-photo-1> .
<#section-1-photo-1> a schema:ImageObject ; dy:sortOrder 1 ;
    schema:contentUrl <../../../media/a/web.webp> ; schema:width 1600 ; schema:height 1067 .
<#section-1-photo-2> a schema:ImageObject ; dy:sortOrder 2 ;
    schema:contentUrl <../../../media/b/web.webp> ; schema:width 1600 ; schema:height 1067 .`),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sections).toHaveLength(1);
    // Order by sortOrder (2 before 1 in document order); assert the filename
    // tail rather than the resolved absolute URL, which depends on the base.
    expect(r.value.sections[0].photos.map((p) => p.contentUrl.split("/").slice(-2).join("/"))).toEqual([
      "a/web.webp",
      "b/web.webp",
    ]);
  });

  it("reports a structured shape error for a section with neither text nor a photo", async () => {
    servePod({
      [URLS.entry]: sectioned(`
    schema:hasPart <#section-1> .
<#section-1> a dy:Section ; dy:sortOrder 1 .`),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run lib/pod/read.test.ts -t "sections"`
Expected: FAIL — `r.value.sections` is undefined (no `sections` on `Entry`, no `sectionsOf`).

- [ ] **Step 3: Add the `Section` schema and `Entry.sections`**

In `lib/pod/schema.ts`, after the `Photo` schema and before `Entry`:

```ts
export const Section = z
  .object({
    text: LangText.optional(),
    photos: z.array(Photo).max(2),
    sortOrder: z.number().int(),
  })
  .refine((s) => s.text !== undefined || s.photos.length > 0, {
    message: "a section needs text or at least one photo",
  });
export type Section = z.infer<typeof Section>;
```

In `Entry`, add the field (keep `articleBody` and `photos` — legacy shim removed in Stage 3; add a one-line pointer):

```ts
  // Legacy `articleBody`/`photos` stay until Stage 3 removes them; new content
  // is `sections`. See ./notes.md#sections-supersede-articlebody-and-photos
  sections: z.array(Section),
```

Add that anchor to `lib/pod/notes.md` with a one-line note citing spec §2 and this plan.

`sections` is **required**, so every place that builds an `Entry` object literal must supply it or `tsc` goes red. Give each a `sections: []` (they keep their `articleBody`/`photos`): `lib/pod/entry-model.test.ts`, `lib/pod/index-model.test.ts`, `hooks/studio/use-entry-form.test.ts`, `hooks/studio/use-entry-save.test.ts`, and production `hooks/studio/use-entry-save.ts` (the save hook's Entry literal — Stage 3 replaces this placeholder with real section-building). Do not add `?? []` guards elsewhere; the field is a real array everywhere.

- [ ] **Step 4: Add `sectionsOf` and wire it into `readEntry`**

In `lib/pod/read.ts`, add `sectionsOf` modelled on `photosOf` (reusing `photosOf` for a section's nested photos, and `langText`):

```ts
/**
 * §7.3's `<#section-n>` shape (spec §3): schema:text, nested schema:image
 * photos, dy:sortOrder. Raw like photosOf — the whole Entry is validated in one
 * pass. ./notes.md#sections-supersede-articlebody-and-photos
 */
export function sectionsOf(quads: Quad[], sectionIris: string[], url: string) {
  return guard(() =>
    sectionIris
      .map((iri) => viewOf(quads, iri))
      .filter((s) => s.exists)
      .map((s) => ({
        text: langText(s, SCHEMA.text),
        photos: take(photosOf(quads, s.all(SCHEMA.image), url)),
        sortOrder: take(integer(s, DY.sortOrder, url)),
      }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
  );
}
```

In `readEntry`, alongside the existing `const photos = take(photosOf(...))` line, add:

```ts
    const sections = take(sectionsOf(quads, v.all(SCHEMA.hasPart), url));
```

and add `sections,` to the object passed to `validate(Entry, { ... }, url)` (keep `photos` and `articleBody`).

- [ ] **Step 5: Run the section tests, the whole read suite, and typecheck**

Run: `npx vitest run lib/pod/read.test.ts && npm run typecheck`
Expected: PASS. The three new cases pass; the existing `readEntry` cases still pass (the old fixture has no `schema:hasPart`, so `sections` is `[]`); `tsc --noEmit` is green because every `Entry` builder now supplies `sections: []`.

- [ ] **Step 6: Commit**

```bash
git add lib/pod/schema.ts lib/pod/read.ts lib/pod/read.test.ts lib/pod/notes.md \
  lib/pod/entry-model.test.ts lib/pod/index-model.test.ts \
  hooks/studio/use-entry-form.test.ts hooks/studio/use-entry-save.test.ts hooks/studio/use-entry-save.ts
git commit -m "Read sectioned entries: the Section schema and sectionsOf"
```

---

### Task 3: Serialise sections

Add `sectionQuads` to the serialiser, mirroring `photoQuads` and sharing a new `imageObjectQuads` helper so the ImageObject-fragment logic is not duplicated. Splice sections into `serialiseEntry`. Legacy `photoQuads`/`articleBody` stay (shim).

**Files:**
- Modify: `lib/pod/entry-model.ts` (extract `imageObjectQuads`; add `sectionQuads`; splice into `serialiseEntry`)
- Modify test: `lib/pod/entry-model.test.ts` (add a `sectionQuads` round-trip case)

**Interfaces:**
- Consumes: `SCHEMA.hasPart`, `SCHEMA.text`, `DY_CLASS.Section` (Task 1); `Entry.sections` (Task 2); existing `Frag`, `text`, `int`, `namedNode`, `quad`, `SCHEMA`, `DY`, `RDF`.
- Produces: `imageObjectQuads(node: NamedNode, photo: Entry["photos"][number], fallbackOrder: number): Quad[]` (a photo fragment's own triples, no link); `sectionQuads(frag: Frag, it: NamedNode, sections: Entry["sections"]): Quad[]`.

- [ ] **Step 1: Write the failing serialiser test**

In `lib/pod/entry-model.test.ts`, mirror the existing photo-clause round-trip (`expectGraph`, `frag`, `IT`, `MEDIA`, `namedNode`, `literal`, `quad`, `SCHEMA`, `DY`, `RDF`, `XSD`). Add:

```ts
it("writes a section: schema:hasPart, dy:Section, text, and a nested photo", async () => {
  const { sectionQuads } = await import("./entry-model");
  await expectGraph(
    sectionQuads(frag, IT, [
      {
        text: { value: "Counter seating, no menu.", language: "en" },
        sortOrder: 2,
        photos: [{ contentUrl: `${MEDIA}/web.webp`, sortOrder: 1 }],
      },
    ]),
    [
      quad(IT, namedNode(SCHEMA.hasPart), frag("section-1")),
      quad(frag("section-1"), namedNode(RDF.type), namedNode(DY_CLASS.Section)),
      quad(frag("section-1"), namedNode(DY.sortOrder), literal("2", namedNode(XSD.integer))),
      quad(frag("section-1"), namedNode(SCHEMA.text), literal("Counter seating, no menu.", "en")),
      quad(frag("section-1"), namedNode(SCHEMA.image), frag("section-1-photo-1")),
      quad(frag("section-1-photo-1"), namedNode(RDF.type), namedNode(SCHEMA.ImageObject)),
      quad(frag("section-1-photo-1"), namedNode(SCHEMA.contentUrl), namedNode(`${MEDIA}/web.webp`)),
      quad(frag("section-1-photo-1"), namedNode(DY.sortOrder), literal("1", namedNode(XSD.integer))),
    ],
  );
});
```

Add `DY_CLASS` to the file's `@/lib/vocab` import if absent.

- [ ] **Step 2: Run and watch fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; npx vitest run lib/pod/entry-model.test.ts -t "section"`
Expected: FAIL — `sectionQuads` is not exported.

- [ ] **Step 3: Extract `imageObjectQuads` and add `sectionQuads`**

In `lib/pod/entry-model.ts`, extract the per-photo fragment body out of `photoQuads` into a shared helper (the fragment's own triples; the caller adds the `schema:image` link):

```ts
/** One schema:ImageObject fragment's own triples (§7.3), no incoming link — the
 *  caller hangs it off `<#it>` or a `<#section-n>` via schema:image. */
export function imageObjectQuads(node: NamedNode, photo: Entry["photos"][number], fallbackOrder: number): Quad[] {
  const quads: Quad[] = [
    quad(node, namedNode(RDF.type), namedNode(SCHEMA.ImageObject)),
    quad(node, namedNode(SCHEMA.contentUrl), namedNode(photo.contentUrl)),
    quad(node, namedNode(DY.sortOrder), int(photo.sortOrder ?? fallbackOrder)),
  ];
  if (photo.thumbnailUrl) quads.push(quad(node, namedNode(SCHEMA.thumbnailUrl), namedNode(photo.thumbnailUrl)));
  if (photo.caption) quads.push(quad(node, namedNode(SCHEMA.caption), text(photo.caption)));
  if (photo.width !== undefined) quads.push(quad(node, namedNode(SCHEMA.width), int(photo.width)));
  if (photo.height !== undefined) quads.push(quad(node, namedNode(SCHEMA.height), int(photo.height)));
  if (photo.encodingFormat) quads.push(quad(node, namedNode(SCHEMA.encodingFormat), literal(photo.encodingFormat)));
  if (photo.dateCreated) quads.push(quad(node, namedNode(SCHEMA.dateCreated), dt(photo.dateCreated)));
  if (photo.blurDataUrl) quads.push(quad(node, namedNode(DY.blurDataUrl), literal(photo.blurDataUrl)));
  return quads;
}
```

Rewrite `photoQuads` to use it (keeps the `schema:image` link and `#photo-<n>` fragment naming):

```ts
export function photoQuads(frag: Frag, it: NamedNode, photos: Entry["photos"]): Quad[] {
  return photos.flatMap((photo, i) => {
    const node = frag(`photo-${i + 1}`);
    return [quad(it, namedNode(SCHEMA.image), node), ...imageObjectQuads(node, photo, i + 1)];
  });
}
```

Add `sectionQuads` (photos are section-scoped: `#section-<i>-photo-<j>`):

```ts
/** §7.3 `<#section-n>` (spec §3): schema:hasPart from <#it>, dy:Section, its
 *  text, and its 0–2 photos as nested ImageObject fragments. */
export function sectionQuads(frag: Frag, it: NamedNode, sections: Entry["sections"]): Quad[] {
  return sections.flatMap((section, i) => {
    const node = frag(`section-${i + 1}`);
    const quads: Quad[] = [
      quad(it, namedNode(SCHEMA.hasPart), node),
      quad(node, namedNode(RDF.type), namedNode(DY_CLASS.Section)),
      quad(node, namedNode(DY.sortOrder), int(section.sortOrder ?? i + 1)),
    ];
    if (section.text) quads.push(quad(node, namedNode(SCHEMA.text), text(section.text)));
    section.photos.forEach((photo, j) => {
      const p = frag(`section-${i + 1}-photo-${j + 1}`);
      quads.push(quad(node, namedNode(SCHEMA.image), p), ...imageObjectQuads(p, photo, j + 1));
    });
    return quads;
  });
}
```

Splice into `serialiseEntry`'s `quads` array, after `photoQuads`:

```ts
  const quads: Quad[] = [
    ...itQuads(it, e),
    ...(e.place ? placeQuads(frag, it, e.place, e.headline.language) : []),
    ...photoQuads(frag, it, e.photos),
    ...sectionQuads(frag, it, e.sections),
  ];
```

- [ ] **Step 4: Run the serialiser tests**

Run: `npx vitest run lib/pod/entry-model.test.ts`
Expected: PASS. The new section case passes; the refactored `photoQuads` keeps every existing photo-clause case green.

- [ ] **Step 5: Commit**

```bash
git add lib/pod/entry-model.ts lib/pod/entry-model.test.ts
git commit -m "Serialise sections, sharing imageObjectQuads with photoQuads"
```

---

### Task 4: The index thumbnail derives from the first section's first photo

`rowOfEntry` currently takes the index `dy:thumbnail` from `entry.photos[0]`. With photos owned by sections, it comes from the first section's first photo. `IndexEntry` and every other derived value are unchanged, so the map/timeline read model (phase-7) is untouched.

**Files:**
- Modify: `lib/pod/index-model.ts:52` (`rowOfEntry` thumbnail)
- Modify test: `lib/pod/index-model.test.ts` (add/adjust a thumbnail-derivation case)

**Interfaces:**
- Consumes: `Entry.sections` (Task 2).
- Produces: nothing new (same `IndexRowInput`).

- [ ] **Step 1: Write the failing test**

In `lib/pod/index-model.test.ts`, add (adapt the existing `rowOfEntry` fixture/helper in that file — read it first for the entry factory it uses):

```ts
it("derives the index thumbnail from the first section's first photo", () => {
  const row = rowOfEntry(
    entryWith({
      photos: [],
      sections: [
        { sortOrder: 1, text: { value: "lead", language: "en" }, photos: [] },
        { sortOrder: 2, photos: [
          { contentUrl: "https://pod/media/x/web.webp", thumbnailUrl: "https://pod/media/x/thumb.webp", sortOrder: 1 },
        ] },
      ],
    }),
  );
  expect(row.thumbnail).toBe("https://pod/media/x/thumb.webp");
});
```

If the file has no `entryWith`/entry factory, construct a minimal `Entry` inline (all required fields; `sections` as above, `photos: []`).

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run lib/pod/index-model.test.ts -t "thumbnail"`
Expected: FAIL — `rowOfEntry` still reads `entry.photos[0]?.thumbnailUrl`, which is `undefined` here.

- [ ] **Step 3: Change the derivation**

In `lib/pod/index-model.ts`, replace line 52:

```ts
    thumbnail: entry.photos[0]?.thumbnailUrl,
```

with the first placed photo across sections in order:

```ts
    thumbnail: entry.sections.flatMap((s) => s.photos)[0]?.thumbnailUrl,
```

- [ ] **Step 4: Run the index tests**

Run: `npx vitest run lib/pod/index-model.test.ts`
Expected: PASS. The new case passes; existing index cases still pass (those entries either carry sections with photos or none, giving `undefined` as before).

- [ ] **Step 5: Commit**

```bash
git add lib/pod/index-model.ts lib/pod/index-model.test.ts
git commit -m "Index thumbnail: the first section's first photo"
```

---

### Task 5: Bump `schemaVersion` to 2, rewrite the §7.3 fixture and the seed

Flip the normative §7.3 entry fixture to the sectioned shape, bump `SCHEMA_VERSION` 1 → 2 (stamping every top-level fixture), and update the seed's `derive()` needles and the read/save-entry test assertions that named the old blob/photo shape. The whole-document round-trip and `graphEquals`-against-fixture cases in `save-entry.test.ts` then exercise sections automatically, because they compare against this fixture.

**Files:**
- Modify: `lib/vocab.ts` (`SCHEMA_VERSION` 1 → 2)
- Modify: `docs/data-model.md` §7.3 (rewrite the entry `` ```turtle `` block) and every top-level fixture's `dy:schemaVersion` (§7.1 diary, §7.2 trip, §7.3 entry, §7.4 index, and the privacy block — wherever `dy:schemaVersion 1` appears)
- Modify: `scripts/seed-dev-pod.ts` (`derive()` needles for the four entry resources)
- Modify test: `lib/pod/read.test.ts` (the `readEntry` "returns a typed entry" assertions; the version-99 `.replace` needle), `lib/pod/save-entry.test.ts` (any `dy:schemaVersion 1`/photo-count assumptions), and any other test doing `.replace("dy:schemaVersion   1", ...)`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a sectioned normative fixture and a seed that writes it.

- [ ] **Step 1: Rewrite the §7.3 entry fixture (in place — do not add a new `` ```turtle `` block)**

`validate:fixtures` guards on exactly 7 Turtle blocks by position; **extend the existing §7.3 block, never add one.** Replace the current `<#it>` `schema:articleBody` blob + `<#photo-1>` with two sections (a text-only lead, then text + the one real photo). The `<#place>`/`<#address>`/`<#geo>` subjects and all `<#it>` scalar fields stay. The new block:

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix schema:  <https://schema.org/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix geo:     <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    a schema:BlogPosting, dy:Entry ;
    schema:headline      "First night in Shinjuku"@en ;
    schema:hasPart       <#section-1>, <#section-2> ;
    schema:datePublished "2026-03-30T08:15:00+09:00"^^xsd:dateTime ;
    schema:contentLocation <#place> ;
    dcterms:created      "2026-03-29T22:03:44+09:00"^^xsd:dateTime ;
    dcterms:modified     "2026-03-30T08:15:00+09:00"^^xsd:dateTime ;
    dcterms:creator      <https://me.solidcommunity.net/profile/card#me> ;
    dy:schemaVersion     2 ;
    dy:slug              "2026-03-29-arrival" ;
    dy:status            dy:Published ;
    dy:trip              <../trip.ttl#it> ;
    dy:occurredAt        "2026-03-29T21:40:00+09:00"^^xsd:dateTime ;
    dy:travelModeFrom    dy:Flight ;
    dy:tag               "food", "trains" .

<#section-1>
    a dy:Section ;
    dy:sortOrder 1 ;
    schema:text "Landed at 17:20 and took the Narita Express in, which was a mistake at rush hour."@en .

<#section-2>
    a dy:Section ;
    dy:sortOrder 2 ;
    schema:text  "Ate standing up at a counter with six seats."@en ;
    schema:image <#section-2-photo-1> .

<#place>
    a schema:Place ;
    schema:name    "Shinjuku, Tokyo"@en ;
    schema:address <#address> ;
    schema:geo     <#geo> .

<#address>
    a schema:PostalAddress ;
    schema:addressLocality "Tokyo"@en ;
    schema:addressCountry  "JP" .

<#geo>
    a schema:GeoCoordinates ;
    schema:latitude    35.6938 ;
    schema:longitude   139.7034 ;
    geo:lat            35.6938 ;
    geo:long           139.7034 ;
    dy:precisionMeters 500 .

<#section-2-photo-1>
    a schema:ImageObject ;
    schema:contentUrl     <../../../media/6f2a1c8e/web.webp> ;
    schema:thumbnailUrl   <../../../media/6f2a1c8e/thumb.webp> ;
    schema:caption        "Counter seating, no menu."@en ;
    schema:width          1600 ;
    schema:height         1067 ;
    schema:encodingFormat "image/webp" ;
    schema:dateCreated    "2026-03-29T21:38:02+09:00"^^xsd:dateTime ;
    dy:blurDataUrl        "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" ;
    dy:sortOrder          1 .
```

Also update the prose after the fixture: where it explained `schema:articleBody`/`<#photo-n>`, replace with the section shape (cite spec §2–§3). Keep the "There is no `schema:isPartOf`" note; add one line that `schema:hasPart` (entry → Section) is domain-clean because a `BlogPosting` is a `CreativeWork`.

- [ ] **Step 2: Bump `SCHEMA_VERSION` and stamp every top-level fixture**

In `lib/vocab.ts`, change `SCHEMA_VERSION = 1` to `2` (update its comment to note the sectioned entry). In `docs/data-model.md`, change every top-level resource's `dy:schemaVersion 1` to `2` (§7.1 diary, §7.2 trip, §7.3 entry — already 2 above, §7.4 index, and the privacy settings block). Do **not** touch the profile/type-index blocks (they carry no `dy:schemaVersion`).

- [ ] **Step 3: Run the RDF gates and watch them fail loudly**

Run: `npm run validate:fixtures && npm run check:vocab`
Expected: `validate:fixtures` PASSES (still 7 blocks; sectioned block parses, fragments resolve, `dy:sortOrder` is integer). `check:vocab` PASSES. If `validate:fixtures` reports a block-count change, you added a block — merge it back into §7.3.

- [ ] **Step 4: Fix the read/save-entry test assertions**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; npx vitest run lib/pod/read.test.ts lib/pod/save-entry.test.ts`
Expected: FAIL in a few named places. Fix each:
- `read.test.ts` "returns a typed entry": replace `expect(r.value.photos).toHaveLength(1)` / `expect(r.value.photos[0].width).toBe(1600)` with `expect(r.value.sections).toHaveLength(2)` and `expect(r.value.sections[1].photos[0].width).toBe(1600)`.
- `read.test.ts` "rejects a schemaVersion it does not understand" (the `TRIP.replace("dy:schemaVersion   1", "...99")`): update the needle to `"dy:schemaVersion   2"` (match the fixture's exact spacing).
- The over-budget-blur case uses a regex `.replace(/dy:blurDataUrl.../)` — it still matches (the photo now lives under `<#section-2-photo-1>`); confirm it passes.
- `save-entry.test.ts`: the round-trip and `graphEquals(ENTRY_TTL, ...)` cases build the spec from the fixture, so they should pass unchanged; fix any hard-coded `dy:schemaVersion 1` or photo-count assumption the run names.

Re-run until green.

- [ ] **Step 5: Update the seed's `derive()` needles**

The seed reads the §7.3 block as `ENTRY` and mutates it with `derive(text, [[find, replace], ...])`, which **throws** naming any stale needle. Run the seed and fix each throw in turn:

Run: `npm run pod:dev &` (wait for `localhost:3001`), then `npm run pod:seed`
Expected: FAIL — `seed: the fixture no longer contains "..."` naming the first needle that referenced the old `schema:articleBody` blob or the `<#photo-1>` caption. For each throw, update that needle to the new section text/caption string in `scripts/seed-dev-pod.ts`. The needles that move:
- The Nara derive: `"First night in Shinjuku"@en` → unchanged (headline); the articleBody-block needle is gone — Nara had none, but confirm.
- The el-chalten derive: the multi-line `articleBody` `find` string no longer exists — split it into the two `schema:text` strings (section-1 "Landed at 17:20…rush hour." → the El Chaltén lead; section-2 "Ate standing up…six seats." → the El Chaltén second). Update the caption and `schema:dateCreated` needles (now under `<#section-2-photo-1>`, same literal text, so they still match).
- The perito-moreno derive (chained off `elChalten`): update its two section-text needles the same way.

Re-run `npm run pod:seed` until it completes without throwing.

- [ ] **Step 6: Run the Pod integration reads**

With the Pod still up:
Run: `npx vitest run test/integration/pod-read.integration.test.ts`
Expected: PASS — the seeded sectioned entries read back through the real reader.

- [ ] **Step 7: Commit**

```bash
git add lib/vocab.ts docs/data-model.md scripts/seed-dev-pod.ts lib/pod/read.test.ts lib/pod/save-entry.test.ts
git commit -m "schemaVersion 2, the sectioned §7.3 fixture, and the seed to match"
```

---

### Task 6: Stage close — the full definition of done on the data layer

Run every gate CLAUDE.md's "Definition of done" lists, read the output, and only then call Stage 1 complete. This stage does **not** touch the phase-7 e2e-gated paths (no `lib/studio/**`, `lib/media/**`, `components/**`, `lib/map/**`, `app/(public)/page.tsx`, etc.), so `test:e2e` is not required — but confirm the diff against that path list before skipping it.

**Files:** none (verification only).

- [ ] **Step 1: Select Node 22 and start the Pod**

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; node -v   # v22.x
npm run pod:dev &            # FIRST — integration tests skip without it
```

- [ ] **Step 2: Run and READ each gate**

```
npm test                  # incl. test/integration/pod-*.integration.test.ts (Pod up)
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure   # notes.md anchors resolve; no length drift introduced
npm run build             # reads the Pod
npm run size:public       # must not move for our code (data-layer change ships nothing public)
npm run format:check
```

Any failure is reported plainly with its output, not summarised as green. `size:public` moving is a boundary failure — Stage 1 adds no public bundle weight.

- [ ] **Step 3: Confirm the e2e gate is genuinely not triggered**

Run: `git diff --name-only main...HEAD` and check none match the phase-7 gated globs (studio, media, public components, map, `app/(public)/page.tsx`, `scripts/seed-dev-pod.ts`). **`scripts/seed-dev-pod.ts` IS on the list** — so run the e2e too:
Run: `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`
Expected: PASS (the media-pipeline and login flows are unaffected by the model change).

- [ ] **Step 4: Update the status memory**

Note in the project status memory that Stage 1 (data layer) of the sectioned entry is done; Stages 2 (public page) and 3 (studio editor + legacy-field removal) remain.

---

## Self-Review

**Spec coverage (of the parts Stage 1 owns):**
- §1 "A `dy:Section` class and the section shape in data-model §3 and §7.3" → Tasks 1, 5. ✔
- §1 "The `Section` Zod schema and the `Entry` change" → Task 2 (adds `sections`; legacy fields kept for green commits, removed in Stage 3 per Staging). ✔
- §1 / §5 "Read parses `schema:hasPart` sections (ordered, nested photos), drops `articleBody`" → Task 2 parses sections; the *drop* is deferred to Stage 3 (shim), noted explicitly. ✔ (partial by design)
- §1 / §6 "Write serialises sections + nested photo fragments; index thumbnail from the first section's first photo" → Tasks 3, 4. ✔
- §1 / §6 "`dy:schemaVersion` bumps to 2; seed and fixtures rewritten" → Task 5. ✔
- §9 "validate:fixtures parses §7.3; check:vocab sees the new terms; schema-coverage sense check; read unit tests (text-only/photo-only/two-photo/mixed, ordering, empty-section refine); write↔read round-trip by graph isomorphism" → Tasks 1 (vocab), 2 (read cases incl. refine + two-photo), 3/5 (round-trip via `save-entry.test.ts` against the fixture). ✔ Note: the read cases cover two-photo and empty-refine directly; text-only/mixed are covered by the fixture's two sections (text-only §1, text+photo §2) exercised through `read.test.ts` and `save-entry.test.ts`.
- Out of Stage 1 by spec §10: the studio editor (§7) → Stage 3; the public page (§8) → Stage 2; the media-pipeline e2e is unchanged (§9).

**Placeholder scan:** No TBD/TODO-in-code. Task 5's seed needles are intentionally driven by the `derive()` throw (the tool names each stale string exactly) rather than guessed whitespace — a concrete, deterministic procedure, not a placeholder. The `entryWith` factory in Task 4 Step 1 falls back to an inline `Entry` if the test file has none.

**Type consistency:** `Section`/`sections` match across schema.ts, read.ts (`sectionsOf`), entry-model.ts (`sectionQuads`), and the tests. `imageObjectQuads(node, photo, fallbackOrder)` is defined in Task 3 and used by both `photoQuads` and `sectionQuads`. `rowOfEntry` keeps its `IndexRowInput` return; only the `thumbnail` expression changes. `SCHEMA_VERSION` bumped once (Task 5), consumed by `itQuads`/`identityQuads` (write) and `schemaVersionOf` (read) — the write side already stamps the constant, never echoes.

**Green-at-every-commit check:** Task 1 additive (check:vocab). Task 2 adds `sections` (empty for old fixtures; `z.array(Section)` accepts `[]`) — existing reads stay green. Task 3 refactor keeps `photoQuads` behaviour. Task 4 changes one derivation, existing entries give `undefined` as before. Task 5 is the one coordinated cutover (constant + fixtures + seed + the tests that named the old shape), all in one commit. No commit leaves the tree red.
