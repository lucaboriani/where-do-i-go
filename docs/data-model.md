# Travel Diary — Pod Data Model

The RDF contract for trips, entries, media and indexes stored in a Solid Pod.

Every other layer depends on this document. Treat predicate names as frozen once phase 1
ships: changing them later means migrating live Pods that you may not control, because other
people will have deployed this app against their own data.

Revision 6. See §14 for what changed and why.

---

## 1. How to use this document

- §2–§6 are rules. Follow them without exception.
- §7 is normative: the Turtle examples are the specification, not illustrations. Commit them
  as test fixtures.
- §8 defines the mapping from Pod triples to the public page's JSON-LD. The two are
  deliberately not identical.
- §13 records the phase-0 results: what was verified against a real Pod, and what remains
  unverified against a hosted provider.

---

## 2. Vocabulary rules

| Prefix | IRI |
|---|---|
| `xsd` | `http://www.w3.org/2001/XMLSchema#` |
| `schema` | `https://schema.org/` |
| `dcterms` | `http://purl.org/dc/terms/` |
| `geo` | `http://www.w3.org/2003/01/geo/wgs84_pos#` |
| `ldp` | `http://www.w3.org/ns/ldp#` |
| `solid` | `http://www.w3.org/ns/solid/terms#` |
| `dy` | `https://example.org/ns/traveldiary#` |

Declare only the prefixes a given resource actually uses. `rdf:` is never declared, because
Turtle's `a` keyword covers `rdf:type` and nothing else in this model needs it.

### Rule 1 — where each vocabulary applies

**dcterms for provenance.** `dcterms:created`, `dcterms:modified`, `dcterms:creator`,
`dcterms:title` on every resource that needs them. DCMI terms assert no `rdfs:domain`, so they
are safe on custom classes and can never produce a domain conflict. This makes dcterms the
correct choice for the internal read model.

**schema.org for anything that appears in public structured data**, and only where the
property is genuinely in the type's domain. Google validates structured data, so a
domain-mismatched property there is a real defect, not a stylistic one.

**dy: for everything else**, including anything schema.org models with the wrong datatype.

### Rule 2 — RDFS domains are inference, not validation

`rdfs:domain` in RDF semantics means "anything in this position is inferred to be of that
class". It does not forbid usage. So `schema:name` on a `dy:Diary` is harmless: it merely
infers that a `dy:Diary` is also a `schema:Thing`, which is true and unproblematic.

The reason to still care about domains is that *some consumers validate anyway* — Google's
structured-data parser and any SHACL shape you write. So:

- On resources whose triples reach the public JSON-LD, keep schema.org usage domain-clean.
- On internal resources (the index, the diary root), prefer dcterms and `dy:`, which have no
  domain constraints to violate.

Custom `dy:` properties deliberately assert **no** `rdfs:domain` and only datatype ranges, so
they can annotate borrowed classes such as `schema:GeoCoordinates` without inferring anything
false about them.

### Rule 3 — the schema.org scheme trap

`http://schema.org/Person` and `https://schema.org/Person` are different IRIs and will never
match each other. Use `https://` everywhere and define it in exactly one constants file.

### Rule 4 — the `dy:` namespace is a project constant

`dy:` must resolve to the same IRI in every deployment of this app, hardcoded, never read from
an environment variable. If each deployer's Pod used its own namespace, two diaries could not
be read by the same code and the interoperability premise collapses.

Use the project's canonical URL and publish a small RDFS document there describing each term.
Replace `https://example.org/ns/traveldiary#` throughout once the domain is settled — it
appears in §7 examples and in `vocab.ts`, nowhere else.

---

## 3. Custom vocabulary

### Classes

- `dy:Diary` — the root object, one per Pod
- `dy:Trip` — a trip; co-typed with `schema:TouristTrip`
- `dy:Entry` — a diary entry; co-typed with `schema:BlogPosting`
- `dy:TripIndex` — the denormalised read model for one trip
- `dy:IndexEntry` — one row in that read model
- `dy:PublicationStatus` — the class of publication states
- `dy:TravelMode` — the class of travel modes

### Individuals

- `dy:Draft`, `dy:Published` — instances of `dy:PublicationStatus`
- `dy:Flight`, `dy:Train`, `dy:Bus`, `dy:Car`, `dy:Boat`, `dy:Bike`, `dy:Walk`, `dy:Other` —
  instances of `dy:TravelMode`

These are IRIs rather than string literals so a typo produces an unresolvable term rather than
a silently distinct value.

### Properties

Structure and identity:

- `dy:slug` (`xsd:string`) — URL segment; stable forever once published
- `dy:status` (`dy:PublicationStatus`) — the single source of truth for publication state
- `dy:schemaVersion` (`xsd:integer`) — on every top-level resource, including entries
- `dy:trip` (IRI) — entry → its trip
- `dy:index` (IRI) — trip → its index resource
- `dy:indexOf` (IRI) — index → its trip, for orphan detection
- `dy:entry` (IRI) — index → a `dy:IndexEntry`
- `dy:entryResource` (IRI) — index entry → the real entry resource

Time and place:

- `dy:startDate`, `dy:endDate` (`xsd:date`) — trip extent
- `dy:occurredAt` (`xsd:dateTime`, offset required) — when the moment happened
- `dy:travelModeFrom` (`dy:TravelMode`) — the leg arriving at this entry
- `dy:precisionMeters` (`xsd:integer`) — how precisely a location is being stated

Index read model (flat by design, see §7.4):

- `dy:lat`, `dy:long` (`xsd:decimal`)
- `dy:thumbnail` (IRI)
- `dy:sortOrder` (`xsd:integer`)
- `dy:bboxWest`, `dy:bboxSouth`, `dy:bboxEast`, `dy:bboxNorth` (`xsd:decimal`)
- `dy:centerLat`, `dy:centerLong` (`xsd:decimal`)
- `dy:entryCount` (`xsd:integer`)

Media and misc:

- `dy:coverImage` (IRI) — curated, not derived
- `dy:blurDataUrl` (`xsd:string`) — a tiny inline placeholder image as a `data:` URI. A plain
  literal, deliberately not language-tagged: base64 is not human-readable in any language, so §6's
  language-tag rule does not reach it. It rides in the entry so the placeholder arrives with the
  HTML and costs no second request; a budget in `lib/media/targets.ts` drops it rather than let it
  bloat a publicly readable resource.
- `dy:originalUrl` (IRI) — the unresized upload, if kept. **Nothing writes this.** Phase 3 decided
  against uploading originals: every view uses the web-sized derivative anyway, and an original at
  a public URL keeps full GPS and device metadata. The term stays reserved rather than deleted,
  because rule 4 makes a `dy:` term permanent and this is the record of what the namespace holds.
- `dy:track` (IRI) — a GeoJSON or GPX file resource
- `dy:tag` (`xsd:string`) — used on both trips and entries

Privacy settings (§7.6 is the resource; §9 is what they do):

- `dy:homeLat`, `dy:homeLong` (`xsd:decimal`) — the centre of the home region
- `dy:homeRadiusMeters` (`xsd:integer`) — its radius. Inside it no coordinate is published at
  all, so this is the one value whose absence must never be read as zero
- `dy:defaultPrecisionMeters` (`xsd:integer`) — the grid a coordinate outside the home region is
  snapped to, and the value written to `dy:precisionMeters` alongside the result

These four live in one owner-only resource (§7.6), and they are the only terms in this document
that are never publicly readable. That is the whole point of them: the home region is the thing
being protected, so publishing its centre and radius would hand any reader the exact answer the
fuzzing exists to withhold.

### Three naming decisions

**Bounding boxes are four separate decimals**, not one packed string. No string parsing means
no parsing bugs, which matters when agents write the serialisation code.

**`dy:tag` rather than `schema:keywords`.** `keywords` is domain-restricted to
`schema:CreativeWork`, which covers entries but not trips. One term used consistently on both,
mapped to `keywords` in the JSON-LD output (§8), beats two terms for one concept.

**`dy:homeLong`, the `…Long` spelling, consistent with `dy:long` and `dy:centerLong`.** Revision 4
spelled it `homeLon` and said so deliberately: the four privacy terms had been agreed with that
spelling, and a predicate becomes a permanent identifier the moment anything writes one (rule 4),
so a rename after the first write means migrating Pods you do not control. That reasoning is why
this was renamed on 2026-09-06 rather than left: the condition it named — "if it is going to
change it has to change *before* that write" — still held. **Nothing had ever written a
`privacy.ttl`**: `initialiseContainers()` creates `/travel/settings/` and deliberately writes no
document into it (§5, §9), the studio has no control that writes one, and the only `privacy.ttl`
in existence is the one `test/integration/pod-access.integration.test.ts` PUTs into a disposable local
Community Solid Server. Agreed with the owner before the edit, per CLAUDE.md.

That window is now closed for all four terms. The next thing to write one of these is the studio,
and after that a rename costs a migration — so `dy:homeLat`, `dy:homeLong`, `dy:homeRadiusMeters`
and `dy:defaultPrecisionMeters` are fixed. Do not "tidy" them afterwards.

### On travel modes and schema.org

schema.org has `schema:Flight`, `schema:TrainTrip` and `schema:BusTrip` as `Trip` subclasses,
which models each leg as a sub-trip and is arguably more faithful. It is also much heavier than
one predicate is worth right now, and `dy:travelModeFrom` remains mechanically convertible to
it later.

---

## 4. Resource layout

```
/travel/
  diary.ttl                      dy:Diary — title, owner, trip list
  settings/
    privacy.ttl                  home region, default precision — OWNER-ONLY (§7.6)
  trips/
    2026-japan/
      trip.ttl                   the dy:Trip / schema:TouristTrip
      entries.ttl                the dy:TripIndex (public read model)
      track.geojson              optional simplified GPS track
      entries/
        2026-03-29-arrival.ttl
        2026-03-31-nara.ttl
  media/
    6f2a1c8e/
      web.webp
      thumb.webp
```

**A media container holds two derivatives and nothing else.** There is no `orig.jpg` beside
them: the camera original is never uploaded, by decision rather than by omission — see §9.
The extension follows whatever the encoder actually produced, so `.webp` is the usual case
rather than a guarantee; see §7.3.

### There is no drafts container

Publication state is `dy:status` plus a per-resource ACL, never a location in the hierarchy.

The alternative — drafting in `/travel/drafts/` and moving on publish — was rejected because
moving a container rewrites every resource IRI beneath it. An entry's RDF identity would change
at publish time, draft URLs could never be shared, and nothing could link to an entry across
the draft boundary. Stability of identity is worth more than the simplicity of container-level
access control.

### The index is the publication boundary

`entries.ttl` is publicly readable and **contains only published entries**. Draft entries exist
as resources with owner-only ACLs and are simply absent from it.

This gives each side exactly one source of truth:

- The **public site** reads `entries.ttl` and can therefore never leak a draft title, even by
  accident, because the data isn't there.
- The **studio** is authenticated and enumerates `entries/` directly via `ldp:contains`, so it
  sees drafts and published entries alike.

A consequence worth internalising: `dy:status` never appears in the index. If you find yourself
adding it, the boundary has been broken.

**But the index is not the only channel.** Phase 0 showed that a publicly readable `entries/`
container can be enumerated by anyone, and `ldp:contains` names every draft resource. Draft
*content* stays protected by its ACL on both WAC and ACP; draft *existence and slug* do not, and
slugs are derived from titles. The index guarantee is real but narrower than it sounds: it
prevents the public site from leaking a draft, not the Pod from doing so.

On WAC the fix is to grant the public `acl:default` on the container **without**
`acl:accessTo` — children stay readable, the listing closes, the authenticated studio still
enumerates. Verified. **The ACP equivalent is untested**, so on a hosted Pod assume draft slugs
are discoverable until proven otherwise, and do not put anything in a slug you would not publish.

### Media is one global container

Media sits outside any trip so that publishing never has to move binaries or rewrite
references.

The trade-off is real: a photo attached to an unpublished draft lives at a publicly readable
URL. With random path segments it is unguessable in practice, but that is obscurity, not access
control. If drafts must be genuinely private, add `/travel/media-private/` with an owner-only
ACL and accept the move-on-publish work for binaries only. Decide this consciously; do not let
it happen by default.

### The settings container is owner-only, and is not the type index

`/travel/settings/` is the only container under `/travel/` whose children are **not** publicly
readable. It holds `privacy.ttl` (§7.6) and nothing else so far.

It needs its OWN ACL, like every other container here, and for a sharper reason than the listing
leak. `acl:default` inherits recursively, so a container created below `/travel/` with no ACL of
its own is covered by the parent's public default — which would make `privacy.ttl` world-readable
and publish the owner's home coordinates to anyone who guessed the path. That is the exact
opposite of what the resource is for, and it would happen silently, on a 201. So
`initialiseContainers()` creates it at first run with public read withheld, before anything can
write into it.

**It is not `{storage}settings/publicTypeIndex.ttl`, and the two must never be merged.** The type
index sits at the *Pod root* under `{storage}settings/`, is found through the owner's profile
document, and has to be given public read explicitly (§7.5). Revision 2 already moved it out of
`/travel/settings/` once, because a type index there "would have been discovered by nothing"
(§14). Same segment name, different container, opposite access requirement. Move neither.

### Naming

Container segment names are always identical to `dy:slug`. This is what makes the public route
`/trips/[slug]` resolvable without a lookup: the app resolves it to
`{root}trips/{slug}/trip.ttl`. Validate the invariant on write and assert it on read — a
mismatch makes an entry unreachable from the web even though it is intact in the Pod.

`entries.ttl` rather than `index.ttl` avoids any server treating `index.*` specially, and
avoids confusion with the diary root. `diary.ttl` rather than `profile` keeps it obvious that
it is not a WebID document.

---

## 5. Access control

The defining constraint of this project is **public read, owner-only write**. That has to be
explicit in the data model, because it determines what may be written where.

### Intended state

**Containers and the documents inside them need different answers.** An earlier revision of
this table said every path was publicly readable, which predates the phase-0 finding that a
publicly *listable* container publishes every draft slug through `ldp:contains` — draft content
stays protected, draft existence and title do not (§4, `docs/decisions.md` §20).

| Path | Listable by the public | Documents inside readable by the public | Write |
|---|---|---|---|
| `/travel/` | **no** | yes | owner |
| `/travel/diary.ttl` | n/a — a document | yes | owner |
| `/travel/trips/` and below | **no** | yes | owner |
| `/travel/media/` | **no** | yes | owner |
| `/travel/settings/` | **no** | **no** | owner |
| `/travel/settings/privacy.ttl` | n/a — a document | **no** | owner |
| any resource with `dy:status dy:Draft` | n/a — a document | **no** | owner |
| `/travel/media-private/`, if used | no | no | owner |

In WAC terms that is the public getting `acl:default` on each container without `acl:accessTo`:
children are readable, the listing is not. Verified on Community Solid Server; **no verified ACP
equivalent exists**, so on an ACP Pod this shape is unproven and `lib/pod/access.ts` reports
`accessUnverified` rather than granting something wider that nobody has measured.

Each container needs its own ACL. Inheritance reaches arbitrary depth — an ACL on
`/travel/trips/` alone makes a document three levels below it readable — but a container with no
ACL of its own is listable if any ancestor grants `accessTo`. Granting on `/travel/` only leaves
`/travel/trips/` enumerable.

`/travel/settings/` is that same rule with the grant removed: its own ACL, and no public
`acl:default` on it either, so public read stops at the container and never reaches
`privacy.ttl`. Letting it inherit the parent's default instead would publish the home
coordinates the resource exists to keep private (§7.6, §9).

Containers carry the default; individual draft resources override it. Publishing an entry is
therefore two operations: flip `dy:status` to `dy:Published`, and relax that resource's ACL.
Both must succeed, so treat it as one transaction with a retry (§10).

### Abstract the mechanism

Solid servers differ on how access control is expressed — Web Access Control with `.acl`
resources, versus Access Control Policies. Which one applies depends on the server, and this
project intends to run against both a hosted Pod now and a self-hosted one later.

So: every access-control operation goes through one interface with roughly four methods —
`makePublic(url)`, `makePrivate(url)`, `getAccess(url)`, `initialiseContainers()`. Two
implementations behind it. Nothing else in the codebase touches access control. If ACL
handling leaks into feature code, the eventual migration becomes a rewrite.

### First-run setup

Creating containers and setting initial ACLs by hand is the step where new deployers give up.
Ship `initialiseContainers()` as a first-run flow that is idempotent and safe to re-run, and
have it verify the resulting access rather than assuming the writes took effect.

It creates four containers: `/travel/`, `/travel/trips/` and `/travel/media/` with public read
reaching the resources inside, and `/travel/settings/` with none. It creates **no documents**.
Content is a write, writes carry the `dy:` namespace, and that is still unresolved — and in the
settings case a default document would also mean choosing a home region on the owner's behalf,
where every possible choice is wrong (§9).

---

## 6. Conventions inside resources

**Every subject is a fragment. Never a bare document URL, never a blank node.**

```
<trip.ttl>       the document
<trip.ttl#it>    the thing the document is about
```

Blank nodes are the largest source of avoidable pain in Solid apps: they cannot be addressed
across requests, they break patch-based updates, and they do not survive round-tripping
reliably. Use fragments — `#it`, `#place`, `#address`, `#geo`, `#photo-1`. This is a lint rule,
not a preference; §11 has the test.

`#it` is the primary subject of every resource. Sub-things use a short descriptive name plus a
one-based index where several can exist.

**Datatypes are always explicit and always the same.** `xsd:date` for trip extent,
`xsd:dateTime` with a UTC offset for instants, `xsd:decimal` for coordinates, `xsd:integer`
for counts and distances. Never `xsd:float` for coordinates.

**Human-readable text is language-tagged**, with a configurable default language. Free now,
impossible to retrofit across two hundred entries.

**Ordering is always explicit.** RDF collections here are sets. `dy:sortOrder` exists because
parse order carries no meaning and must never be relied on.

---

## 7. Turtle by example

These are normative. Byte-level formatting is not (see §11).

### 7.1 Diary root — `/travel/diary.ttl`

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    a dy:Diary ;
    dcterms:title       "Somewhere Else"@en ;
    dcterms:description "Notes and photographs from the road."@en ;
    dcterms:creator     <https://me.solidcommunity.net/profile/card#me> ;
    dcterms:modified    "2026-04-20T18:02:11+02:00"^^xsd:dateTime ;
    dy:schemaVersion    1 ;
    dy:trip             <trips/2026-japan/trip.ttl#it> ,
                        <trips/2025-patagonia/trip.ttl#it> .
```

All dcterms, no schema.org: this resource is internal and never becomes structured data, so
there is nothing to gain from a domain-constrained vocabulary here.

The trip list powers the home page and the all-trips globe. Denormalising each trip's title and
cover image into this resource is tempting; resist until the trip count makes N+1 fetches
actually hurt, because it is another index to keep in sync.

### 7.2 Trip — `/travel/trips/2026-japan/trip.ttl`

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix schema:  <https://schema.org/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix geo:     <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    a schema:TouristTrip, dy:Trip ;
    schema:name        "Japan, spring"@en ;
    schema:description "Three weeks from Tokyo to Kyushu, mostly by train."@en ;
    schema:tripOrigin  <#origin> ;
    dcterms:created    "2026-03-01T09:12:00+01:00"^^xsd:dateTime ;
    dcterms:modified   "2026-04-20T18:02:11+02:00"^^xsd:dateTime ;
    dcterms:creator    <https://me.solidcommunity.net/profile/card#me> ;
    dy:schemaVersion   1 ;
    dy:slug            "2026-japan" ;
    dy:status          dy:Published ;
    dy:startDate       "2026-03-28"^^xsd:date ;
    dy:endDate         "2026-04-17"^^xsd:date ;
    dy:index           <entries.ttl#it> ;
    dy:coverImage      <../../media/6f2a1c8e/web.webp> ;
    dy:track           <track.geojson> ;
    dy:tag             "japan", "trains", "food" .

<#origin>
    a schema:Place ;
    schema:name "Milan"@en ;
    schema:geo  <#origin-geo> .

<#origin-geo>
    a schema:GeoCoordinates ;
    schema:latitude    45.4642 ;
    schema:longitude   9.1900 ;
    geo:lat            45.4642 ;
    geo:long           9.1900 ;
    dy:precisionMeters 5000 .
```

**Why `dy:startDate` and not `schema:startDate`.** `schema:Trip` carries `arrivalTime` and
`departureTime`, both ranged as DateTime or Time. There is no date-typed property in Trip's
domain, and a travel diary wants dates, not times. Rather than assert a property outside the
type's domain, the Pod stores honest `xsd:date` values under `dy:` and the JSON-LD serialiser
derives `departureTime` / `arrivalTime` from them (§8).

**`schema:tripOrigin` is optional but useful**: it gives the first entry's arrival leg a start
point, so the route line can be drawn from home rather than beginning in mid-air.

No bounding box here. It lives on the index (§7.4) with the rest of the derived data.

### 7.3 Entry — `/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl`

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix schema:  <https://schema.org/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix geo:     <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    a schema:BlogPosting, dy:Entry ;
    schema:headline      "First night in Shinjuku"@en ;
    schema:articleBody   """Landed at 17:20 and took the Narita Express in, which
was a mistake at rush hour. Ate standing up at a counter with six seats."""@en ;
    schema:datePublished "2026-03-30T08:15:00+09:00"^^xsd:dateTime ;
    schema:contentLocation <#place> ;
    schema:image         <#photo-1> ;
    dcterms:created      "2026-03-29T22:03:44+09:00"^^xsd:dateTime ;
    dcterms:modified     "2026-03-30T08:15:00+09:00"^^xsd:dateTime ;
    dcterms:creator      <https://me.solidcommunity.net/profile/card#me> ;
    dy:schemaVersion     1 ;
    dy:slug              "2026-03-29-arrival" ;
    dy:status            dy:Published ;
    dy:trip              <../trip.ttl#it> ;
    dy:occurredAt        "2026-03-29T21:40:00+09:00"^^xsd:dateTime ;
    dy:travelModeFrom    dy:Flight ;
    dy:tag               "food", "trains" .

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

<#photo-1>
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

Notes on this shape:

- **`dy:occurredAt` carries the local UTC offset of the place.** "21:40+09:00" renders as
  9:40pm in Tokyo for every reader. Normalising to UTC destroys the fact that it was evening,
  which for a travel diary is most of the meaning.
- **`dcterms:created` and `schema:datePublished` are not redundant.** With drafts, created is
  when the record came into being and datePublished is when it became public. They differ by
  however long the draft sat.
- **`dy:travelModeFrom` describes the leg arriving here.** Its start point is the previous
  entry in `dy:sortOrder`, or the trip's `schema:tripOrigin` for the first entry. Omit the
  property entirely when unknown, or when the first entry has no origin; the route renderer
  skips legs it cannot resolve.
- **There is no `schema:isPartOf`.** Its range is `CreativeWork` or `Product`, and a
  `TouristTrip` is neither. `dy:trip` is the only entry-to-trip link, which also removes the
  earlier redundancy.
- **Coordinates are mirrored into `geo:`** because extra triples are nearly free and any
  generic Linked Data tool understands WGS84. `schema:` remains the one your code reads.
- **`dy:precisionMeters` drives rendering**, so "somewhere in Kyoto" and "this exact ramen
  counter" do not look identical on the map. Small values get a pin, large values a soft circle.
- **The derivatives are WebP — expected, not guaranteed.** WebP is what the encoder asks for
  first, being roughly a third smaller than JPEG at equal quality, which is storage and bandwidth
  on someone's Pod forever. What comes back is a separate question, and three actors are involved:
  - **The browser** does not fail an encode it cannot perform. `OffscreenCanvas.convertToBlob`
    returns a **PNG** for a type it does not support, silently, rather than throwing.
  - **This app** therefore reads the media type back off the returned blob instead of trusting
    the request. If WebP was not honoured, the encode is retried as `image/jpeg`. If that is not
    honoured either, the PNG is stored honestly as a PNG or the write is refused — never
    mislabelled.
  - **What is written** — both `schema:encodingFormat` and the file extension — comes from the
    type the blob ACTUALLY has, never from the type that was requested. So `web.webp` and
    `"image/webp"` in the fixture above are the normal outcome, and code must not assume them.
- **`dy:originalUrl` is gone from this example** because nothing writes it; see §3.

### 7.4 Index — `/travel/trips/2026-japan/entries.ttl`

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    a dy:TripIndex ;
    dy:indexOf       <trip.ttl#it> ;
    dy:schemaVersion 1 ;
    dcterms:modified "2026-04-20T18:02:11+02:00"^^xsd:dateTime ;
    dy:entryCount    14 ;
    dy:bboxWest      129.8721 ;
    dy:bboxSouth     31.5904 ;
    dy:bboxEast      139.8107 ;
    dy:bboxNorth     35.7148 ;
    dy:centerLat     33.6526 ;
    dy:centerLong    134.8414 ;
    dy:entry         <#e-2026-03-29-arrival>, <#e-2026-03-31-nara> .

<#e-2026-03-29-arrival>
    a dy:IndexEntry ;
    dy:entryResource   <entries/2026-03-29-arrival.ttl#it> ;
    dcterms:title      "First night in Shinjuku"@en ;
    dy:slug            "2026-03-29-arrival" ;
    dy:occurredAt      "2026-03-29T21:40:00+09:00"^^xsd:dateTime ;
    dy:lat             35.6938 ;
    dy:long            139.7034 ;
    dy:precisionMeters 500 ;
    dy:thumbnail       <../../media/6f2a1c8e/thumb.webp> ;
    dy:travelModeFrom  dy:Flight ;
    dy:sortOrder       1 .
```

This resource is the reason the app feels fast. One fetch renders the timeline, the map markers,
the route line, the archive list, the fit-to-bounds initial view and the OG image. Keep it
strictly to what those views need — adding `articleBody` here would make it grow without bound
and defeat the point.

**Derived data lives here, not on the trip.** Bounding box, center and entry count are all
functions of the entry set. Putting them on `trip.ttl` meant every entry write touched three
resources and made the trip a write-contention point for an entry-local operation. Here, an
entry write touches two resources, all derived values share one `dcterms:modified`, and
`rebuildIndex` regenerates the lot in one pass. The server-rendered map needs the bbox before
any JavaScript runs, and it is already fetching this resource.

**The index is flat and uses `dy:` geo terms deliberately.** `schema:latitude` belongs to
`GeoCoordinates` and `schema:thumbnailUrl` to `CreativeWork`; a `dy:IndexEntry` is neither, and
introducing a `#geo-n` fragment per point to be pedantic would roughly double the size of the
one resource fetched on every single page view. This is a private read model with no interop
obligations, so flat wins. The entry resource (§7.3) remains the domain-clean interop surface.

`dy:sortOrder` sits alongside `dy:occurredAt` so entries sharing a timestamp can be hand-ordered
without touching the entry resources.

### 7.5 Type index registration

**Revised after phase 0.** An earlier revision assumed the WebID profile already points at a
type index and that registrations are appended to that document. Neither held on either server
tested — see §13. What follows is what actually works.

**The WebID document may not be writable, and may not be in the Pod at all.** On Inrupt ESS it
is served by the identity provider and returns `405` to `PATCH`. On Community Solid Server it is
writable, but ships with no `solid:publicTypeIndex`. So the app must never assume it can modify
the WebID document, and must never assume a type index already exists.

What the WebID *does* reliably carry is where to go next:

```turtle
@prefix foaf:  <http://xmlns.com/foaf/0.1/> .
@prefix pim:   <http://www.w3.org/ns/pim/space#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

<#me>
    a              foaf:Agent ;
    solid:oidcIssuer <https://login.inrupt.com> ;
    pim:storage      </> ;
    rdfs:seeAlso     </extendedProfile> .
```

- **`pim:storage`** is how the app discovers the Pod root. Use it instead of asking the user to
  paste a storage URL, and instead of deriving one from the WebID's origin — on ESS identity and
  storage are different hosts entirely.
- **`rdfs:seeAlso`** (with `foaf:isPrimaryTopicOf` alongside it on ESS) points at an extended
  profile document that lives **in the Pod** and therefore *is* writable.

**Discovery procedure**, in order, so one code path serves both server families:

1. Read the WebID. If it declares `solid:publicTypeIndex`, use that.
2. Otherwise read the `rdfs:seeAlso` profile document and look for `solid:publicTypeIndex` there.
3. Otherwise create `{storage}settings/publicTypeIndex.ttl`, then write the
   `solid:publicTypeIndex` link into **whichever profile document is writable** — the extended
   profile first, falling back to the WebID document. If neither accepts the write, the container
   root becomes configuration rather than discovery, and the app must be told where the diary
   lives.

**The type index must be given public read explicitly.** Created under `{storage}settings/` it
inherits owner-only access on both servers tested, and a type index nobody can read discovers
nothing. Grant it through the §5 interface, not by writing an ACL directly.

Registrations are appended to that document, never replacing it:

```turtle
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix dy:    <https://example.org/ns/traveldiary#> .

<#traveldiary-diary>
    a solid:TypeRegistration ;
    solid:forClass dy:Diary ;
    solid:instance </travel/diary.ttl#it> .

<#traveldiary-trips>
    a solid:TypeRegistration ;
    solid:forClass          dy:Trip ;
    solid:instanceContainer </travel/trips/> .
```

Fragment names are prefixed with the app name because this document is shared with every other
Solid app the owner uses, and collisions would silently overwrite their registrations. Appending
via an `InsertDeletePatch` was verified to leave a different app's existing registration intact.

This is what lets other Solid apps find the data, and what lets your own app locate an existing
diary instead of hardcoding `/travel/`.

### 7.6 Privacy settings — `/travel/settings/privacy.ttl`

**Owner-only. This resource is never publicly readable** (§4, §5), and it is the only resource in
this document with that property.

```turtle
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dy:      <https://example.org/ns/traveldiary#> .

<#it>
    dcterms:modified          "2026-09-06T11:20:04+02:00"^^xsd:dateTime ;
    dy:schemaVersion          1 ;
    dy:homeLat                45.4655 ;
    dy:homeLong               9.1866 ;
    dy:homeRadiusMeters       3000 ;
    dy:defaultPrecisionMeters 500 .
```

**The home coordinate is stored at full precision, and this is the one place in the project where
that is right.** Everywhere else §9 applies and the Pod holds only what is published; here the
resource is not published, and a fuzzed centre would fuzz the *boundary* rather than the thing
inside it — entries just outside a mis-placed circle get published, entries just inside a
correctly placed one do not. Store the centre exactly and let `dy:homeRadiusMeters` carry the
slack.

**Nothing here has a default, and a half-written home region is an error.** A reader that treats
an absent `dy:homeRadiusMeters` as zero has no home region at all, and publishes coordinates from
the owner's doorstep while reporting success. So the three home values are accepted **all together
or not at all** — never one or two of them — and `dy:defaultPrecisionMeters` is required outright,
with no built-in fallback, because a fallback is a distance this project would be choosing for
someone else's front door.

Omitting all three home values is a legitimate configuration and means "I have no home to
protect": fuzzing still applies to every coordinate, it just never drops one. That is a different
fact from "the settings could not be read", which is never a value at all — it is a structured
error, and §9's fail-closed rule takes over.

**A stored `dy:homeRadiusMeters` of 0 is rejected on read** — not read as "no home region",
and not read as a point. No deliberate configuration produces it: the studio has no control that
writes a zero radius, so it means a partial or corrupted write, and §9's fail-closed rule is the
right answer to that. What a fuzzing implementation should compute for a zero radius is a
separate question, and it stays with that module; nothing valid arrives there carrying one.

**No `rdf:type`, deliberately.** Every other resource here is typed and this one is not: the four
terms in §3 are the four that were agreed with the owner, and a class would be a fifth (rule 4,
and CLAUDE.md's "ask before doing"). The read gates on `dy:schemaVersion` and on the shape
instead, which is what it would have to do anyway — a type gate never protected against a
resource that parses and means something else. If a class for this resource is agreed later,
adding it is purely additive and nothing here moves.

**`dcterms:modified` is here for the same reason it is on every other resource**: this document is
read, edited and written back, and §10's `If-Match` needs a read that produced the state being
edited. The ETag does that job; `modified` is what a human reads.

---

## 8. JSON-LD mapping for public pages

Pod triples and public structured data are close but not identical. The differences are
deliberate: the Pod stores honest datatypes, and the public output satisfies a validator.

| Public JSON-LD | Derived from |
|---|---|
| `@type: BlogPosting` | present as-is on the entry |
| `headline` | `schema:headline` |
| `articleBody` | `schema:articleBody` |
| `datePublished` | `schema:datePublished` |
| `dateModified` | `dcterms:modified` |
| `author` | `dcterms:creator`, expanded to a `Person` with `name` from the profile |
| `keywords` | `dy:tag`, joined |
| `image` | `schema:image` → `contentUrl` |
| `contentLocation` | present as-is |
| `@type: TouristTrip` | present as-is on the trip |
| `name`, `description` | present as-is |
| `departureTime` | `dy:startDate`, widened to `xsd:dateTime` |
| `arrivalTime` | `dy:endDate`, widened to `xsd:dateTime` |
| `itinerary` | an `ItemList` built from the index, in `dy:sortOrder` |

Everything in the left column is domain-valid for its type. Nothing `dy:` reaches the output.
Keep this mapping in one serialiser module and test it against a structured-data validator in
CI if you can.

---

## 9. Coordinate and metadata privacy

Resources are publicly readable, so a design that stores a true coordinate next to a
"please blur this" flag leaks immediately: anyone can fetch the raw triple.

**The Pod stores only the coordinate you are willing to publish.** The studio applies fuzzing
before the write and discards the precise original. `dy:precisionMeters` then honestly describes
what was stored, and doubles as the rendering hint. Fuzzing at render time is not a weaker version
of this — it is not a mitigation at all, because by then the precise value is already sitting in a
world-readable resource and has been since the write.

### Where the settings live, and why nowhere easier

The home region and the default precision are configuration, so the two obvious homes for them are
an environment variable and `localStorage`. Both are wrong here, and not marginally:

- **An env var passed down as a prop bakes the answer into public HTML.** `/studio` builds as
  `○ (Static)`, so a build-time prop is prerendered — and the prerendered HTML is served to anyone
  who asks for `/studio`, with no session, because the route guard is UX and not security
  (CLAUDE.md invariant 5). The owner's home coordinates would be in the page source of a public
  URL.
- **`localStorage` is per-browser, so it fails open exactly when it matters.** A new phone, a
  cleared profile, a second laptop: the studio comes up with no home region and the next entry
  publishes a coordinate near home. It is silent, and it happens while travelling — which is when
  the diary is actually being written.

The owner's own Pod, in an owner-only resource, is the only place that is private, survives a
change of device, and keeps the Pod as the only datastore. Hence §7.6.

### What is applied, before the write

1. **Read the settings** (§7.6). If they cannot be read — absent, unreadable, a
   `dy:schemaVersion` this app does not understand, or a partial home region — **no coordinate is
   published at all**. See "fail closed" below.
2. **Inside the home radius, drop the coordinate entirely. Do not coarsen it.** Coarsening maps
   every entry near home onto one grid cell, and the centroid of that cell is the owner's home to
   within the cell size. A hundred entries "fuzzed to 2 km" therefore resolve to a single point
   that is the house, and each new entry sharpens it. Publishing nothing publishes nothing;
   publishing a coarse value publishes it *repeatedly*, and the repetition is what makes it
   precise. The entry is still written, with its place name if it has one — it is the geometry
   that is absent, not the entry.
3. **Outside it, snap to a deterministic grid** of `dy:defaultPrecisionMeters`, and write
   `dy:precisionMeters` to match what was actually done. Deterministic, not random: a jitter
   re-rolled per write leaks the true position through the mean of repeated edits of one place,
   and makes one place look like several. The same coordinate and the same settings must always
   produce the same output.
4. **Rendering follows `dy:precisionMeters`**, so a snapped point draws as a circle the size of
   its uncertainty rather than as a pin claiming a precision nobody has.

A photo's GPS is a coordinate like any other. It goes through steps 1–4 before anything is
written, not after.

### Fail closed

"No readable settings" and "no home region" are different facts, and only one of them is safe to
act on. So the read returns a structured error rather than a filled-in default, and every caller
publishes no coordinate on any error.

The consequence is worth stating plainly, because it is the common case rather than the rare one:
**on a Pod that has never had a `privacy.ttl`, every entry is written with no coordinate.**
`initialiseContainers()` creates `/travel/settings/` but deliberately writes no document into it
(§5), so this is what a brand-new deployment does by default. The studio has to say so out loud —
an entry silently losing its map pin becomes a bug report, whereas "you have not set a home region
yet" is a one-time setup step with an obvious fix.

### EXIF

**EXIF is stripped during the client-side resize**, from `web.webp` and `thumb.webp` both.

**Originals are not uploaded.** Decided in phase 3, and recorded here rather than re-argued.
Phase-0 question 5 — what storage quota a provider gives you, and what happens when you exceed it
— was meant to decide this, and came back unanswerable: the only hosted provider tested is a
Developer Preview, so its limits are not representative of anything (§13, item 5). The decision
does not need that answer. Every view in this app renders the web-sized derivative, so an original
earns nothing but bulk against someone's Pod quota whatever that quota turns out to be; and an
original at a public URL is a full-resolution file carrying exactly the GPS and device metadata
that the two derivatives just had removed. Hence a media container holds two files, not three
(§4), and `dy:originalUrl` stays reserved with nothing writing it (§3).

Should that ever be reopened, there is one alternative worth the argument and one that is not.
The arguable one is uploading originals with EXIF stripped as well, accepting an archival copy
that is lossy in metadata. **Uploading originals with metadata intact to a public container is
not a third option** — it never was, and stripping the derivatives while publishing the source
would defeat the whole step.

---

## 10. Write protocol

### Preconditions

- **Creating** a resource: `If-None-Match: *`. Fails if something is already there.
- **Updating** a resource: `If-Match: <etag>` from the read that produced the state you edited.
  Fails on concurrent modification; refetch and retry.

Never write without a precondition. A blind PUT is how a phone tab that was open for two days
silently reverts a week of edits.

### Creating a published entry

1. `PUT` the entry resource with `If-None-Match: *`
2. Set the entry's ACL (owner-only if draft, public-read if published)
3. Read `entries.ttl`, insert the index entry, recompute `entryCount`, bbox and center, write
   back with `If-Match`
4. Call the revalidation hook so the public site drops its cache

Publishing an existing draft is steps 2–4 with `dy:status` flipped in step 1.

### The failure mode to design for

Step 1 succeeding and step 3 failing leaves an entry that exists but is unlisted: invisible,
not corrupt. Step 2 succeeding and step 3 failing is the same, and step 1 succeeding with step 2
failing leaves a published-but-unreadable entry, which the public site simply cannot see.

All three recover through the same operation:

**`rebuildIndex(trip)`** — enumerate `entries/` via `ldp:contains`, read each entry, keep those
with `dy:status dy:Published`, regenerate `entries.ttl` from scratch, and verify each kept
entry's ACL matches its status.

Build this in phase 1, not when you first need it. It is also how you migrate the index shape
when `dy:schemaVersion` increments, and how a new deployer imports data written by an older
version of the app.

---

## 11. Agent guardrails

1. **One `vocab.ts` exporting every IRI as a named constant.** No predicate string literals
   anywhere else in the codebase. This is the highest-value rule in this document; without it
   you will end up with three spellings of the same property scattered across your Pod.
2. **Validate on read.** A Pod contains whatever was written to it, including data from an
   older version of your own app and, in principle, from someone else's. Every read goes
   through a parser returning a typed object or a structured error. Never index into raw
   triples inside a component.
3. **Check `dy:schemaVersion` on every read** of a top-level resource, entries included.
   Version 1 costs nothing now and makes migration possible later.
4. **Fragments only, no blank nodes.** Add a test that fails if serialised output contains a
   blank-node label.
5. **The fixtures are checked by the same parser the application uses.**
   `scripts/validate-fixtures.ts` runs on `n3`, which is also what reads Pod resources. This
   keeps the project to one language and one RDF stack, at the cost of the cross-check an
   independent implementation would give: a bug or quirk in `n3` passes both the fixture check
   and the code that depends on it. Accepted deliberately — see `docs/decisions.md` §23. If a
   fixture ever looks right but behaves oddly in practice, validate it against a second parser
   before assuming the document is correct.

6. **Compare triple sets, never bytes.** Turtle has no canonical form: prefix order, predicate
   grouping, whitespace and `35.6938` versus `35.69380` are all free choices that any library
   upgrade may change. Parse both sides and assert graph isomorphism against the §7 fixtures.
   A byte-comparison test would be permanently red and quickly ignored.
7. **Assert the slug invariant**: `dy:slug` equals the containing path segment, on both write
   and read.
8. **Access control goes through the §5 interface only.** Add a lint rule against importing ACL
   primitives outside that module.
9. **Pin library majors** and keep a short cheat sheet of the Solid client API surface in the
   repo. These libraries are thinly represented in training data and agents will confidently
   invent method names.

---

## 12. Deliberately out of scope

- **Comments and guestbooks.** Would attach via an inbox on the entry. Nothing here blocks it;
  visitors simply do not have Pods.
- **Multi-traveler trips.** Would add `dy:companionTrip` pointing at another Pod's trip
  resource, with the reader merging two indexes. The trip/index split already supports this:
  aggregation happens over indexes, which are small and cheap to fetch cross-origin.
- **Offline sync.** Needs a client-side operation log and a per-resource ETag cache. The
  precondition-based protocol in §10 is the right foundation for it.
- **Entry revision history.** `dcterms:modified` is here; full history would mean an
  append-only `revisions/` container per entry.

---

## 13. Phase 0 results

Verified 2026-09-02 against **two servers**: Community Solid Server 7.2.0 (WAC) and a hosted
**Inrupt PodSpaces** Pod (ESS, ACP). Full evidence and method in `docs/phase-0-spike.md`.

1. **Can the app write to the profile-linked type index (§7.5)?** **No on ESS, and not as
   described on CSS. §7.5 needs rewriting.**

   - On **ESS** the WebID document is served by the identity provider (`id.inrupt.com`), not by
     the Pod. `PATCH` returns **405 Method Not Allowed**, so the app cannot add
     `solid:publicTypeIndex` to it at all. The writable profile is `{POD}extendedProfile`,
     reachable from the WebID via `rdfs:seeAlso` / `foaf:isPrimaryTopicOf`; the WebID also
     carries `pim:storage` pointing at the Pod root, which is the correct way to discover
     storage.
   - On **CSS** the profile *is* writable and the `PATCH` succeeded, but the profile ships with
     no `solid:publicTypeIndex`, and a type index created under `/settings/` inherits owner-only
     access — it returned 401 to anonymous readers until given an explicit public-read ACL. A
     type index nobody can read discovers nothing.
   - A registration written by a different app survived the append on CSS.

   **Action:** §7.5 must stop assuming a writable, type-index-linked WebID. Discovery should
   follow `rdfs:seeAlso` to a Pod-hosted profile document, and `initialiseContainers()` owns
   creating it, linking it, and making it publicly readable.

2. **Which access-control mechanism, and does the §5 abstraction cover it?** **CSS = WAC,
   ESS = ACP, and the §5 abstraction held across both.** `universalAccess.setPublicAccess`
   from `@inrupt/solid-client` granted public read on both servers with identical calling code.

   **Detection trap:** ESS advertises `Link: <https://authorization.inrupt.com/{id}>; rel="acl"`
   — a separate authorization host, not a sibling `.acl`. The control resource contains both
   `acp#` and `auth/acl#` vocabulary, because ACP reuses `acl:` mode IRIs. Branching on the
   `acl` link relation reports "WAC" for an ACP server. Do not branch on mechanism; go through
   the §5 interface.

   **Decision 4 is cleared on both mechanisms.** Per-resource override works: inside a
   public-read container, an owner-only resource returned 401 to a logged-out reader while its
   published sibling stayed 200 and the owner kept access, on WAC and on ACP.

   **One correction to §4.** The claim that the index makes a draft leak "structurally
   impossible" is too strong on both servers. Draft *content* is protected; draft *existence and
   slug* are not, because a publicly readable container can be enumerated and `ldp:contains`
   names the draft resource. On CSS this is fixed by granting the public `acl:default` without
   `acl:accessTo`, which closes the listing while keeping children readable — **verified on WAC,
   untested on ACP**, which has no equivalent split.

3. **Does an unauthenticated `fetch` of a public resource succeed from the Next.js server?**
   **Yes on both.** A server component using plain `fetch` — no Solid library — rendered Pod
   triples into the initial HTML from CSS. On ESS a bare `curl` against a public resource
   returned 200 and the triples.

   ESS fronts protected resources with **UMA** (`WWW-Authenticate: UMA as_uri=…, ticket=…`),
   which looks like it breaks invariant 3 but does not: the challenge applies to protected
   resources only, and genuinely public ones need no negotiation. Note that ESS returns **401,
   not 404, for absent resources** to anonymous callers, so an anonymous 401 does not
   distinguish private from missing.

4. **Are `ETag`, `If-Match` and `If-None-Match` honoured?** **Yes on both servers.** Re-create
   with `If-None-Match: *` → 412; valid `If-Match` accepted; **stale `If-Match` → 412**. §10 is
   sound as specified. ETag *shapes* differ — CSS returns `"<ms-timestamp>-<content-type>"`,
   ESS a content hash — so treat ETags as opaque and never parse them. Binary-resource
   preconditions were verified on CSS only.

5. **Is there a storage quota, and what happens on exceeding it?** **Unanswerable at the time,
   and it stayed that way.** PodSpaces is Developer Preview and explicitly not for production or
   personal data, so its limits would not have been representative of anything. §9's originals
   question was the one thing waiting on this figure. **It was settled later without it**: phase 3
   decided that originals are not uploaded, on grounds that never needed a quota number — see §9.
   Quota therefore blocks nothing; it is simply still unmeasured.

6. **Does `ldp:contains` enumeration stay usable at a few hundred entries?** **Yes on CSS;
   unmeasured on ESS.** CSS returned 200 resources in one response, 45.1 KB, no pagination and
   no `rel="next"`; enumeration median 23 ms, and the full `rebuildIndex` shape 0.6 s at
   concurrency 12 versus 1.1 s serially. These are localhost figures with no network latency.
   **The number that matters — 200 sequential reads against a hosted Pod over real RTT — has
   not been measured.** `rebuildIndex` must read concurrently regardless.

**Still open before phase 2:** the ACP equivalent of the draft-listing fix (item 2), hosted
enumeration cost (item 6), quota (item 5), and §7.5's rewrite for `extendedProfile` (item 1).
Separately, a static `client-id.jsonld` cannot be exercised from localhost against a hosted
provider — it needs a deployed origin — so the login flow phase 2 ships is not yet testable
end to end.

## 14. Change log

**Revision 6** adds one predicate for media, and closes the originals question.

- **`dy:blurDataUrl`** (`xsd:string`, §3) is the one new term, agreed with the owner before the
  work started. A plain literal, deliberately untagged: §6 asks for a language tag on
  human-readable literals, and base64 is not human-readable in any language. **No existing
  predicate, class or datatype changed.**
- **§7.3's photo is WebP** — `web.webp`, `thumb.webp`, `schema:encodingFormat "image/webp"` — and
  §4, §7.2, §7.4 and §9 were brought to the same spelling. For one revision this document
  described the same media container, `6f2a1c8e/`, in two different ways, which is worse than
  either spelling alone because both looked normative. §7.3's note now separates what the browser
  does (`convertToBlob` returns PNG rather than throwing) from what this app does about it (read
  the type back, retry as JPEG), so WebP reads as the expected case and not a promise.
- **`dy:originalUrl` leaves the §7.3 fixture and stays in §3.** Rule 4 makes a `dy:` term
  permanent, and §3 is the record of what the namespace holds. **Nothing writes it.**
- **§9 records the originals decision rather than presenting it as open**, and §4's tree drops
  `orig.jpg` with a line saying why it is absent. Originals are not uploaded. Phase-0 item 5
  (§13) came back unanswerable — the provider is a Developer Preview — and the decision never
  depended on that answer: every view renders the web-sized derivative, and an original at a
  public URL carries exactly the GPS and device metadata the derivatives had stripped. §13 item 5
  no longer claims the question is open.

**Revision 5** renames one predicate and changes nothing else.

- **`homeLon` → `dy:homeLong`** in §3, §7.6 and here. Agreed with the owner, per CLAUDE.md's
  "ask before doing". `dy:long` and `dy:centerLong` already used the `…Long` spelling, and the
  TypeScript surface spells the field `long` on both `GeoPoint` and `HomeRegion`, so the old
  spelling was the odd one out in its own document.
- **It was free, and it stops being free next.** Rule 4 makes a predicate permanent from the
  first write, and revision 4's own note said the rename had to happen before that write or not
  at all. Nothing has written a `privacy.ttl`: `initialiseContainers()` creates
  `/travel/settings/` and writes no document into it (§5), the studio has no control that writes
  one, and the only instance anywhere is the fixture `test/integration/pod-access.integration.test.ts` PUTs
  into a disposable local Community Solid Server. The `dy:` namespace is also still
  `example.org`, so no live Pod holds one either.
- No other predicate, class, datatype or fixture changed. §3's naming note now records the
  rename and closes the window on all four privacy terms.

**Revision 4** adds the privacy-settings resource, for coordinate fuzzing (§9, phase 3).

- §3 gains four properties: `dy:homeLat` and `dy:homeLong` (`xsd:decimal`, spelled `homeLon`
  until revision 5 above), `dy:homeRadiusMeters`
  and `dy:defaultPrecisionMeters` (`xsd:integer`). Agreed with the owner before being written
  here, per CLAUDE.md. **No existing predicate, class or datatype changed**, and every §7 fixture
  from revision 3 is unaltered.
- §7.6 is a new normative fixture, `/travel/settings/privacy.ttl`. It carries no `rdf:type`,
  deliberately: a class would have been a fifth new term and four were agreed.
- §4 and §5 gain `/travel/settings/`, the only container under `/travel/` whose children are not
  publicly readable — its own ACL, and no public `acl:default` on it.
  `initialiseContainers()` creates it, and creates no document inside it.
- §9 stops calling the home radius "a good default" and states what was decided: a deterministic
  grid snap outside the home region, the coordinate **dropped entirely** inside it rather than
  coarsened, and a read that **fails closed** — no readable settings, no published coordinate. It
  also records why the settings can be neither an env var (`/studio` is `○ (Static)`, so a
  build-time prop is prerendered into publicly readable HTML) nor `localStorage` (per-browser, so
  it fails open on a new device, while travelling).

**Revision 3** records what phase 0 verified against two servers (Community Solid Server / WAC
and Inrupt ESS / ACP), and corrects what it disproved:

- §7.5 rewritten. The assumption that the WebID profile already links a type index, and that the
  app can append to it, is false on both servers and impossible on ESS, where the WebID document
  is served by the identity provider and rejects `PATCH` with 405. Discovery now goes through
  `pim:storage` and `rdfs:seeAlso`, with an explicit fallback order, and the type index must be
  given public read deliberately.
- §4 gains a caveat: the index prevents the *public site* leaking a draft, but a publicly
  readable container still exposes draft slugs via `ldp:contains`. The WAC mitigation is
  recorded; the ACP equivalent is untested.
- §13 replaced with results rather than assumptions. Decision 4 is cleared on both mechanisms.
- No predicate, class or datatype changed. The §7 fixtures are unchanged apart from the profile
  example in §7.5, which now shows the discovery triples the app actually reads.

**Revision 2** corrects the following from revision 1:

- `schema:startDate` / `endDate` replaced with `dy:startDate` / `dy:endDate`, since neither is
  in `schema:Trip`'s domain. §8 now documents the mapping to `departureTime` / `arrivalTime`.
- Type index registration moved into the profile-linked document; the invented
  `/travel/settings/publicTypeIndex.ttl` would have been discovered by nothing.
- `dcterms:title` on entries replaced with `schema:headline`; vocabulary choice is now governed
  by the rules in §2 rather than being ad hoc per field.
- The drafts container is gone. Moving containers rewrote resource IRIs at publish time, which
  broke identity stability. Publication state is now `dy:status` plus a per-resource ACL, with
  the index as the publication boundary.
- `If-None-Match: *` for creation, `If-Match` for updates. Revision 1 specified `If-Match` for
  both, which cannot work for a resource that does not exist yet.
- `dy:PublicationStatus` and `dy:TravelMode` added as classes; their members were previously
  listed as classes rather than individuals.
- Byte-for-byte fixture comparison replaced with graph isomorphism. The original advice would
  have produced a flaky test suite.
- Bounding box, center and entry count moved from the trip to the index, removing a write to a
  contended resource on every entry save.
- `dy:travelModeFrom` is now defined for the first entry, via `schema:tripOrigin`.
- `dy:schemaVersion` now appears on entries, matching what the guardrails always required.
- `schema:isPartOf` dropped from entries: range violation, and redundant with `dy:trip`.
- `schema:keywords` replaced by `dy:tag`, valid on trips as well as entries.
- Index entries use `dy:lat` / `dy:long` / `dy:thumbnail` instead of borrowing schema.org
  properties outside their domain, with the rationale for keeping the index flat.
- `schema:addressCountry` moved onto a `schema:PostalAddress` fragment, where it belongs.
- Added §5 on access control, absent from revision 1 despite being the project's defining
  constraint.
- Added §8 JSON-LD mapping, §13 phase-0 checklist, and explicit slug resolution rules.
- Removed the unused `rdf`, `rdfs` and `foaf` prefixes.
