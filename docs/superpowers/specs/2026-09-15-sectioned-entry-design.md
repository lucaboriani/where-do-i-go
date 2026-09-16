# Sectioned entry — design

An entry stops being *one `schema:articleBody` blob + a flat photo list* and becomes an
**ordered list of sections**, each carrying its own text and up to two photos. This is a
content-model change (the RDF contract, the schema, read/write, the studio editor), decided with
the maintainer on 2026-09-15. It supersedes phase-7's Task 3 (the entry restyle) — the entry's
look-and-feel is now applied to sections rather than to a single prose blob.

`docs/data-model.md` is the normative RDF authority; this spec says what changes there and why. The
full-bleed photograph treatment validated against real images on 2026-09-15 (spec
`2026-09-15-look-and-feel-phase-7-design.md` §10) applies per section.

## 1. What ships

- A `dy:Section` class and the section shape in `docs/data-model.md` §3 (vocab) and §7.3 (entry).
- The `Section` Zod schema and the `Entry` schema change (drop `articleBody`, add `sections`).
- Read: `lib/pod/read.ts` parses `schema:hasPart` sections (ordered, nested photos), drops
  `articleBody`.
- Write: `lib/pod/save-entry.ts` serialises sections + nested photo fragments; the index thumbnail
  derives from the first section's first photo.
- `dy:schemaVersion` bumps to **2**; the seed and fixtures are rewritten to the sectioned shape.
- The studio entry editor gains section authoring (add / remove / reorder sections; each with a
  text field and 0–2 photos).
- The public entry page renders sections with the phase-7 look.

Out of scope: any other entry field (place, dates, travel mode, tags, provenance are unchanged);
the trip/diary/map surfaces (phase-7 Tasks 4–9, independent — the index read model does not change
shape); a live Pod (the `dy:` namespace blocker still holds — only disposable local CSS data
exists, which is why there is no migration).

## 2. The section shape (decided)

- **Flexible.** A section may be text-only, photo-only (1–2), or both. Constraint: **at least one**
  of text or ≥1 photo — an empty section is invalid. **At most two** photos.
- **Photos are owned by their section**, as fragments under the entry resource, not an entry-level
  pool. There is no longer a flat entry-level photo list.
- **Order** is `dy:sortOrder` on each section, and on each photo within a section — the same
  hand-ordering pattern §7.4 already uses, never parse order (§7 "parse order carries no meaning").

## 3. RDF (the §7.3 rewrite)

The only NEW vocabulary term is the class **`dy:Section`**. Everything else reuses existing terms:
`schema:hasPart` (entry → sections), `schema:text` (section prose), `schema:image` (section →
photo), `dy:sortOrder`, and the unchanged `Photo` shape. `schema:hasPart` and `schema:text` join
`lib/vocab.ts` and §3; `check:vocab` enforces both directions and `validate:fixtures` parses the
Turtle below.

```turtle
<#it>
    a schema:BlogPosting , dy:Entry ;
    dy:schemaVersion 2 ;
    dy:slug "2026-03-29-arrival" ;
    dy:status dy:published ;
    schema:headline "First night in Shinjuku"@en ;
    schema:hasPart <#section-1> , <#section-2> , <#section-3> ;
    dy:occurredAt "2026-03-29T21:40:00+09:00"^^xsd:dateTime ;
    schema:datePublished "2026-03-30T02:00:00+09:00"^^xsd:dateTime ;
    dcterms:created "2026-03-30T02:00:00+09:00"^^xsd:dateTime ;
    dcterms:creator <https://…/profile/card#me> ;
    dy:travelModeFrom "Train" ;
    schema:contentLocation <#place> .

<#section-1>                         # text-only: the lead
    a dy:Section ;
    dy:sortOrder 1 ;
    schema:text "Landed at 17:20 and took the Narita Express in, which…"@en .

<#section-2>                         # text + one photo
    a dy:Section ;
    dy:sortOrder 2 ;
    schema:text "Counter seating, no menu."@en ;
    schema:image <#section-2-photo-1> .

<#section-2-photo-1>
    a schema:ImageObject ;
    dy:sortOrder 1 ;
    schema:contentUrl <https://…/web.webp> ;
    schema:thumbnail <https://…/thumb.webp> ;
    schema:caption "Counter seating, no menu."@en ;
    schema:width 1600 ; schema:height 1067 ;
    schema:encodingFormat "image/webp" ;
    dy:blurDataUrl "data:image/webp;base64,…" .

<#section-3>                         # photo-only: two photos, no text
    a dy:Section ;
    dy:sortOrder 3 ;
    schema:image <#section-3-photo-1> , <#section-3-photo-2> .

<#section-3-photo-1> a schema:ImageObject ; dy:sortOrder 1 ; schema:contentUrl <…> ; … .
<#section-3-photo-2> a schema:ImageObject ; dy:sortOrder 2 ; schema:contentUrl <…> ; … .
```

Fragment naming: `#section-<n>` and `#section-<n>-photo-<m>`. Fragments only, no blank nodes
(the hard rule holds). The `Photo` predicates are exactly today's — the media pipeline, EXIF
stripping, coordinate fuzzing, and blur budget all carry over untouched.

## 4. The Zod schema (`lib/pod/schema.ts`)

```ts
export const Section = z
  .object({
    text: LangText.optional(),
    photos: z.array(Photo).max(2),   // 0–2; Photo is unchanged
    sortOrder: z.number().int(),
  })
  .refine((s) => s.text !== undefined || s.photos.length > 0, {
    message: "a section needs text or at least one photo",
  });
export type Section = z.infer<typeof Section>;
```

`Entry` drops `articleBody` and `photos`, and gains `sections: z.array(Section)`. Everything else
in `Entry` is unchanged. `schemaVersion` is checked === 2 on read (the version gate already
exists).

## 5. Read (`lib/pod/read.ts`)

Parse `schema:hasPart` → each section resource: `schema:text` (optional LangText), `schema:image`
→ nested `Photo` objects (reuse the existing photo parser), `dy:sortOrder`. Sort sections and their
photos by `sortOrder`. Drop the `articleBody` and entry-level `schema:image` parsing. Validate
through `Section`/`Entry`; a section failing the refine is a structured read error, not a throw
(the "validate on read" rule).

## 6. Write (`lib/pod/save-entry.ts`) + version + seed

- Serialise `sections` to `schema:hasPart` + `dy:Section` fragments + nested photo fragments, each
  with `dy:sortOrder`. Preserve the §10 write sequence and the ETag precondition (`If-Match` /
  `If-None-Match`) — unchanged.
- Bump `dy:schemaVersion` to 2 wherever the writer stamps it.
- The index thumbnail (§7.4 `IndexEntry.thumbnail`) now derives from the **first section's first
  photo** (was the entry's first photo). The `IndexEntry` shape does NOT change — the map/timeline
  read model is untouched, so phase-7 Tasks 4–9 are unaffected.
- `scripts/seed-dev-pod.ts` and the `docs/data-model.md` fixtures are rewritten to sectioned
  entries. Re-seed after; no migration of old data (there is none).

## 7. Studio editor (the largest chunk)

The entry editor replaces the single `articleBody` textarea with a **section list**:

- Each section row: a text field (optional) + a photo area holding 0–2 photos, using the existing
  photo pipeline (client-side resize in a worker, EXIF strip, blur, coordinate fuzz — all unchanged;
  a photo attaches to a section instead of to the entry).
- Add section, remove section, reorder sections (the `dy:sortOrder` is derived from list position
  on save). Reorder photos within a section (max 2 enforced in the UI and the schema).
- Autosave (`lib/studio/drafts.ts`) persists the section list; the draft schema changes with the
  entry schema, and its version key bumps so an old flat draft is invisible rather than
  half-restorable (the existing `wig.draft.v1` → `v2` pattern).
- The owner check, the write sequence, ACL handling — all unchanged.

## 8. The public entry page (the phase-7 look, per section)

`EntryContent` renders the masthead (display) + meta row as phase-7 already specifies, then the
sections in order:

- A **text-only** section: prose in Syne at the body treatment (17px / 1.75 / measure).
- A **one-photo** section: the photo full-bleed to the reading column, with its caption in mono and
  any section text as prose above it.
- A **two-photo** section: the pair side by side (the mockup's `.pair`), stacking on narrow widths.
- The entry renders inside the trip's map-shell reading column, so "full-bleed" is full **column**
  width on desktop, full viewport on mobile.
- `<SiteFooter>` at the content end (the phase-7 correction).

No component becomes newly interactive; this is server-rendered markup + the phase-7 CSS.

## 9. Testing

- `validate:fixtures` parses the §7.3 sectioned Turtle (IRI resolution, no blank nodes, datatypes).
- `check:vocab` sees `dy:Section`, `schema:hasPart`, `schema:text` in both `lib/vocab.ts` and §3.
- A schema-coverage sense check: every predicate in the §7.3 block appears in the `Entry`/`Section`
  Zod schema (the gap that once dropped `dcterms:created`).
- Read: unit tests for text-only / photo-only / two-photo / mixed sections, ordering by
  `sortOrder`, and the empty-section refine failing as a structured error.
- Write ↔ read round-trip by **graph isomorphism** (never bytes).
- Studio editor: component tests for add/remove/reorder, the max-2 constraint, autosave of sections,
  and the draft version bump hiding an old flat draft.
- The media pipeline e2e (real bytes) is unchanged — a photo still resizes/strips/blurs; it just
  lands under a section.
- Entry page: structural tests that sections render in order with the right treatment per shape.

## 10. How this relates to phase 7

- **Supersedes phase-7 Task 3.** The entry restyle is delivered by this feature (§8), not by the
  original within-the-old-model task.
- **Phase-7 Tasks 4–9 are independent** and proceed on their own (trip, diary, arc, markers, globe,
  view transitions) — none touches the entry content model, and the index read model is unchanged.
- Sequencing: this feature is built as its own spec → plan → subagent-driven TDD loop; phase-7
  Tasks 4–9 resume around it (order TBD with the maintainer, but they do not block each other).

## 11. Open, deliberately

- **`dy:Section` vs reusing `schema:CreativeWork`.** A dedicated `dy:` class is clearer and matches
  the project's existing dy: classes; the cost is one new permanent term, which the maintainer
  authorised. Recorded, not re-litigated.
- **Reorder affordance in the editor** (drag vs up/down buttons) is a UI detail for the plan, not
  the model.
- The `dy:` namespace is still `example.org`; nothing here reaches a live Pod.
