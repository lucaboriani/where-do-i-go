/**
 * The studio's local draft store — lib/studio/drafts.ts, which does not exist yet.
 *
 * THE RED STEP OF THE TDD LOOP. `docs/decisions.md` §10 is the reason this
 * module is wanted at all: "the studio autosaves in-progress text to
 * localStorage, because losing a long entry in a hostel is what kills the
 * habit." TODO.md carries it as the last open item of phase 2.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONTRACT THIS FILE ASSERTS, since it is what is being designed here:
 *
 *   type StorageLike  = { getItem(k): string | null; setItem(k, v): void;
 *                         removeItem(k): void }
 *   type DraftAddress = { webId: string; scope: string }
 *   type Draft        = exactly thirteen fields — see FIELDS below
 *
 *   draftKey(at: DraftAddress): string
 *   readDraft(storage: StorageLike, at: DraftAddress): Draft | null
 *   writeDraft(storage: StorageLike, at: DraftAddress, draft: Draft): boolean
 *   clearDraft(storage: StorageLike, at: DraftAddress): void
 *
 * THE STORAGE IS INJECTED, NEVER REACHED FOR. `localStorage` is a global that
 * throws on access in some embedded browsers before you have even called a
 * method on it, and a module that reaches for it is a module that cannot run in
 * the node environment this file uses. The editor supplies the real one; every
 * test here supplies a fake whose failures are scripted.
 *
 * NOTHING HERE THROWS, EVER — that is the headline invariant, and section 5 is
 * most of this file. A draft store that throws on a corrupt value takes the
 * whole editor down with it on mount, which turns "we kept a backup of your
 * text" into "you cannot open the editor at all". Every hostile input below is
 * a thing a real browser really produces: a half-written value from a tab that
 * was killed mid-write, a payload from a build with a different shape, a Safari
 * private-mode quota error on the first setItem, storage disabled entirely.
 *
 * WHAT MAY NEVER BE PERSISTED, and section 3 exists for it alone: the ETag,
 * `dcterms:created` and `schema:datePublished`. All three come from the read
 * that produced the editor's state (§10). A draft that carried the ETag and was
 * restored an hour later would condition the next write on a version the Pod
 * has long since replaced — a blind PUT wearing a helpful hat — and a restored
 * `created` would overwrite §7.3's "when the record came into being" with a
 * value from whenever the draft happened to be saved.
 */

import { describe, expect, it } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
 * 0. Reaching a module that is not there yet.
 *
 * Lifted from test/studio-trips.test.ts and test/entry-editor.test.tsx, for the
 * reason given there: a static `import … from "@/lib/studio/drafts"` is resolved
 * by vite's import-analysis before a single test runs, so the whole FILE fails
 * to load and vitest reports one transform error instead of N failing
 * assertions. A specifier held in a parameter is opaque to that pass.
 *
 * `typeof import(…)` below is a TYPE, erased before import-analysis sees it, so
 * it costs nothing at runtime — and `tsc --noEmit` reporting "Cannot find
 * module '@/lib/studio/drafts'" IS the correct red state for this step. The
 * three type aliases derived from it are not decoration: they pin the parameter
 * ORDER and the return types against the real module once it exists, which a
 * locally re-declared signature would have replaced with this file's opinion.
 * ════════════════════════════════════════════════════════════════════════ */

type DraftsModule = typeof import("@/lib/studio/drafts");
type Draft = NonNullable<ReturnType<DraftsModule["readDraft"]>>;
type StorageLike = Parameters<DraftsModule["readDraft"]>[0];
type DraftAddress = Parameters<DraftsModule["readDraft"]>[1];

/** Opaque to vite:import-analysis by construction: the specifier is a
 *  parameter. `@vite-ignore` only silences the warning that says so. */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

async function loadDrafts(): Promise<DraftsModule> {
  const mod = (await importModule("@/lib/studio/drafts").catch((cause: unknown) => {
    throw new Error(
      "lib/studio/drafts.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as DraftsModule;
  for (const name of ["draftKey", "readDraft", "writeDraft", "clearDraft"] as const) {
    if (typeof mod[name] !== "function") {
      throw new Error(`lib/studio/drafts.ts exists but exports no ${name} — still the red step.`);
    }
  }
  return mod;
}

describe("the loader this file reaches the module through", () => {
  /**
   * The control, and it earns its place: with the trick above, "the module is
   * missing" and "the loader resolves nothing" look identical from the outside,
   * and the second would make every test below fail for a reason that is not
   * the module's. Both directions, against a module that certainly exists and
   * one that certainly does not.
   */
  it("resolves the @/ alias, and rejects what is absent", async () => {
    const known = (await importModule("@/lib/pod/entry-model")) as { documentUrlOf?: unknown };
    expect(typeof known.documentUrlOf).toBe("function");
    await expect(importModule("@/lib/studio/definitely-not-here")).rejects.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The fixtures, and the fake storage.
 * ════════════════════════════════════════════════════════════════════════ */

const OWNER = "https://me.solidcommunity.net/profile/card#me";
/** A second signed-in person on the same browser. Their draft must be invisible
 *  to the owner, and the owner's to them: one machine, two accounts, and the
 *  text of an unfinished entry is not something to hand to whoever logs in next. */
const SOMEONE_ELSE = "https://borrowed-laptop.example/profile/card#me";

const TRIP_IRI = "https://me.solidcommunity.net/travel/trips/2026-japan/trip.ttl#it";
/** The scope of an EDIT: the entry document URL, exactly as `documentUrlOf`
 *  spells it — no fragment. */
const ENTRY_URL =
  "https://me.solidcommunity.net/travel/trips/2026-japan/entries/2026-04-02-kyoto.ttl";
/** The scope of a CREATE. A literal, because there is no resource yet to name. */
const NEW = "new";

const AT_NEW: DraftAddress = { webId: OWNER, scope: NEW };
const AT_ENTRY: DraftAddress = { webId: OWNER, scope: ENTRY_URL };

/**
 * The thirteen fields, sorted. Asserted as a SET rather than field by field,
 * because "exactly these" is the property that matters: a fourteenth field is
 * how the ETag gets in, and a missing one is a field the editor silently stops
 * restoring.
 *
 * NINE UNTIL 2026-09-06. `lat`, `long` and `precision` arrived with the
 * editor's coordinate controls, and they are why the key moved to `v2` — nine
 * fields restored into a twelve-field form is the half-restore the version
 * segment exists to prevent. All three hold what the FORM holds: strings, empty
 * when nothing has been typed, because a half-written entry with no coordinate
 * yet is the common draft and a schema that demanded a number here would refuse
 * to back it up. test/entry-editor.test.tsx section 8h owns the decision that
 * what is kept is the coordinate as TYPED rather than as published.
 *
 * `photos` ARRIVED WITH THE EDITOR'S PICKER, and the key did NOT move with it —
 * the one time the version test is answered "no". A `v2` payload cannot carry a
 * photo, because there was no control to attach one with, so an older draft
 * restores an empty list: the truth about that draft rather than a default
 * standing in for something lost. It is a `Photo[]` and not a form string
 * because the editor uploads on pick and then holds URLs; see the field's own
 * docblock in lib/studio/drafts.ts, and section 6 below for the empty-list
 * default.
 */
const FIELDS = [
  "headline",
  "lat",
  "long",
  "mode",
  "occurred",
  "photos",
  "precision",
  "savedAt",
  "slug",
  "status",
  "story",
  "tagsText",
  "tripIri",
];

/** What the form holds mid-sentence. `occurred` is the wall clock the
 *  datetime-local control hands back — no offset, because that control has
 *  none; `savedAt` is the one field that must carry one. */
const DRAFT: Draft = {
  tripIri: TRIP_IRI,
  slug: "2026-04-02-kyoto",
  headline: "Rain on the Philosopher's Path",
  story: "Two hours of drizzle and nobody else on the path.",
  occurred: "2026-04-02T16:20",
  tagsText: "walking, rain",
  mode: "Train",
  status: "draft",
  lat: "35.026345",
  long: "135.794782",
  precision: "500",
  // The common draft: text typed, no photo attached yet. The photo-carrying
  // cases are section 6's, where they are the subject rather than the setting.
  photos: [],
  savedAt: "2026-04-02T19:00:00+09:00",
};

const VALID_JSON = JSON.stringify(DRAFT);

/**
 * A storage whose every method can be told to throw, and whose contents are
 * inspectable. `items` is the browser's side of the seam; `calls` is what the
 * module did to it.
 */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(initial));
  const calls = { get: [] as string[], set: [] as { key: string; value: string }[], remove: [] as string[] };
  const fail: { get: Error | null; set: Error | null; remove: Error | null } = {
    get: null,
    set: null,
    remove: null,
  };

  const storage: StorageLike = {
    getItem(key: string) {
      calls.get.push(key);
      if (fail.get !== null) throw fail.get;
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      calls.set.push({ key, value });
      if (fail.set !== null) throw fail.set;
      items.set(key, value);
    },
    removeItem(key: string) {
      calls.remove.push(key);
      if (fail.remove !== null) throw fail.remove;
      items.delete(key);
    },
  };

  return { storage, items, calls, fail };
}

/** Safari in private mode, on the very first setItem. Not a hypothetical: it
 *  reports a zero quota rather than refusing storage outright, so the failure
 *  arrives at write time and not at feature-detection time. */
const QUOTA = new DOMException("The quota has been exceeded.", "QuotaExceededError");

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The key, and the round trip.
 * ════════════════════════════════════════════════════════════════════════ */

describe("draftKey", () => {
  it("is wig.draft.v2.<webId>.<scope>", async () => {
    const { draftKey } = await loadDrafts();
    expect(draftKey(AT_NEW)).toBe(`wig.draft.v2.${OWNER}.${NEW}`);
    expect(draftKey(AT_ENTRY)).toBe(`wig.draft.v2.${OWNER}.${ENTRY_URL}`);
  });

  /**
   * The three things the key is doing, each stated as a collision that must not
   * happen rather than as a substring of the string above.
   */
  it("separates the version, the person and the entry", async () => {
    const { draftKey } = await loadDrafts();

    // A create and an edit are different drafts. Sharing a key would show the
    // text of a new entry as the unsaved draft of an existing one.
    expect(draftKey(AT_NEW)).not.toBe(draftKey(AT_ENTRY));
    // Two entries are different drafts.
    expect(draftKey(AT_ENTRY)).not.toBe(
      draftKey({ webId: OWNER, scope: `${ENTRY_URL.replace("kyoto", "nara")}` }),
    );
    // Two people are different drafts.
    expect(draftKey(AT_NEW)).not.toBe(draftKey({ webId: SOMEONE_ELSE, scope: NEW }));
    // And the version is IN the key, which is how the coordinate fields could
    // be added at all: v1's nine-field payloads became invisible rather than
    // half-restorable the moment this became v2.
    expect(draftKey(AT_NEW)).toContain(".v2.");
  });
});

describe("writeDraft / readDraft", () => {
  it("round-trips exactly the thirteen fields, and stores them under the key", async () => {
    const { draftKey, readDraft, writeDraft } = await loadDrafts();
    const { storage, items, calls } = fakeStorage();

    expect(writeDraft(storage, AT_NEW, DRAFT)).toBe(true);

    // The key really is the one draftKey names — asserted on the call, so a
    // module that computed a different key internally cannot pass.
    expect(calls.set.map((c) => c.key)).toEqual([draftKey(AT_NEW)]);
    expect(items.has(draftKey(AT_NEW))).toBe(true);

    const back = readDraft(storage, AT_NEW);
    expect(back).not.toBeNull();
    expect(back).toEqual(DRAFT);
    expect(Object.keys(back!).sort()).toEqual(FIELDS);
  });

  it("keeps an empty travel mode, an empty story and a published status", async () => {
    // `mode` is `TravelMode | ""` — the editor's "Not recorded" option — and an
    // empty string is not the same as an absent field. A schema that required a
    // TravelMode would refuse to store the most common state of a half-written
    // entry, which is the state this whole feature exists for.
    const { readDraft, writeDraft } = await loadDrafts();
    const { storage } = fakeStorage();
    const sparse: Draft = { ...DRAFT, mode: "", story: "", tagsText: "", status: "published" };

    expect(writeDraft(storage, AT_NEW, sparse)).toBe(true);
    expect(readDraft(storage, AT_NEW)).toEqual(sparse);
  });

  it("answers null when there is no draft at all", async () => {
    const { readDraft } = await loadDrafts();
    const { storage } = fakeStorage();
    expect(readDraft(storage, AT_NEW)).toBeNull();
  });

  /** The scoping, as behaviour rather than as string arithmetic. */
  it("does not hand one person's draft to another, or a create's to an edit", async () => {
    const { readDraft, writeDraft } = await loadDrafts();
    const { storage } = fakeStorage();

    writeDraft(storage, AT_NEW, { ...DRAFT, headline: "the owner's new entry" });
    writeDraft(storage, AT_ENTRY, { ...DRAFT, headline: "the owner's edit" });
    writeDraft(storage, { webId: SOMEONE_ELSE, scope: NEW }, { ...DRAFT, headline: "not yours" });

    // The allow-case first: each address reads back its own, so this is not a
    // reader that answers null for everything.
    expect(readDraft(storage, AT_NEW)?.headline).toBe("the owner's new entry");
    expect(readDraft(storage, AT_ENTRY)?.headline).toBe("the owner's edit");
    expect(readDraft(storage, { webId: SOMEONE_ELSE, scope: NEW })?.headline).toBe("not yours");

    // And nothing leaks across.
    expect(readDraft(storage, { webId: SOMEONE_ELSE, scope: ENTRY_URL })).toBeNull();
  });

  /**
   * THE VERSION PREFIX, tested as the thing it is for: a payload written by a
   * build with a different shape is invisible, not half-restored.
   *
   * Both halves in one test. The same bytes at the v1 key DO read back, so this
   * cannot pass by a reader that answers null whatever it is given.
   */
  it("ignores a payload stored under a different version of the key", async () => {
    const { draftKey, readDraft } = await loadDrafts();
    const current = draftKey(AT_NEW);
    // v1 is not hypothetical: it is what every build before 2026-09-06 wrote,
    // and its payloads are nine-field ones that would half-fill today's form.
    const previous = current.replace(".v2.", ".v1.");
    // The mutation really happened: a replace that missed would leave two
    // identical keys and make the assertion below vacuous.
    expect(previous).not.toBe(current);

    expect(readDraft(fakeStorage({ [previous]: VALID_JSON }).storage, AT_NEW)).toBeNull();
    expect(readDraft(fakeStorage({ [current]: VALID_JSON }).storage, AT_NEW)).toEqual(DRAFT);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. WHAT IS NEVER PERSISTED. The ETag, dcterms:created, schema:datePublished.
 *
 * §10: the precondition is the ETag "from the read that produced this state".
 * A draft survives a reload, a browser restart and a week on a shelf; the ETag
 * it was saved beside does not survive any of them. Restoring one would produce
 * an `If-Match` the Pod refuses at best, and at worst — if the resource has
 * cycled back to a matching tag — an overwrite of an edit made elsewhere.
 *
 * `created` and `datePublished` are the data-loss bug this repository already
 * shipped once, in the other direction (TODO.md, phase 2): both belong to the
 * entry as the Pod holds it, and a value round-tripped through localStorage is
 * a value from whenever the draft happened to be saved.
 * ════════════════════════════════════════════════════════════════════════ */

describe("what a draft must never carry", () => {
  const FORBIDDEN = ["etag", "created", "datePublished"];

  it("writes none of them, even when handed them", async () => {
    const { draftKey, writeDraft } = await loadDrafts();
    const { storage, items } = fakeStorage();

    // Cast, because the whole point is that the type does not admit these. A
    // caller spreading the editor's state into a draft is exactly how they get
    // in, and the type is erased at runtime.
    const contaminated = {
      ...DRAFT,
      etag: '"entry-7"',
      created: "2026-03-29T22:03:44+09:00",
      datePublished: "2026-03-30T08:15:00+09:00",
    } as unknown as Draft;

    expect(writeDraft(storage, AT_NEW, contaminated)).toBe(true);

    const stored = items.get(draftKey(AT_NEW));
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(FIELDS);
    for (const field of FORBIDDEN) {
      expect(Object.keys(parsed), `${field} reached storage`).not.toContain(field);
    }
  });

  /**
   * And restores none of them, from a payload that has them.
   *
   * THIS IS THE PIN THE DESIGN ASKS FOR: if anyone later adds `etag` to the
   * persisted shape, the schema starts keeping it and this fails. It also
   * settles the unknown-key question for the whole module — the schema STRIPS
   * what it does not know rather than rejecting the value, so a payload from a
   * slightly different build still restores its twelve fields instead of being
   * thrown away. test/entry-editor.test.tsx leans on that choice.
   */
  it("restores none of them, and still restores the twelve that are legitimate", async () => {
    const { draftKey, readDraft } = await loadDrafts();
    const payload = JSON.stringify({
      ...DRAFT,
      etag: '"entry-7"',
      created: "2026-03-29T22:03:44+09:00",
      datePublished: "2026-03-30T08:15:00+09:00",
    });
    // The mutation really happened.
    expect(payload).not.toBe(VALID_JSON);

    const { storage } = fakeStorage({ [draftKey(AT_NEW)]: payload });
    const back = readDraft(storage, AT_NEW);

    // The allow-case: the legitimate twelve came back, so this is not a reader
    // that refused the whole payload and passed by returning nothing.
    expect(back).toEqual(DRAFT);
    expect(Object.keys(back!).sort()).toEqual(FIELDS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. clearDraft.
 * ════════════════════════════════════════════════════════════════════════ */

describe("clearDraft", () => {
  it("removes its own draft and leaves every other one alone", async () => {
    const { clearDraft, draftKey, readDraft, writeDraft } = await loadDrafts();
    const { storage, calls } = fakeStorage();
    const elsewhere = { webId: SOMEONE_ELSE, scope: NEW };

    writeDraft(storage, AT_NEW, DRAFT);
    writeDraft(storage, AT_ENTRY, DRAFT);
    writeDraft(storage, elsewhere, DRAFT);

    clearDraft(storage, AT_NEW);

    expect(calls.remove).toEqual([draftKey(AT_NEW)]);
    expect(readDraft(storage, AT_NEW)).toBeNull();
    // The allow-case: a clear that emptied the whole store would satisfy the
    // line above and lose two other people's work.
    expect(readDraft(storage, AT_ENTRY)).toEqual(DRAFT);
    expect(readDraft(storage, elsewhere)).toEqual(DRAFT);
  });

  it("is quiet when there is nothing to clear", async () => {
    const { clearDraft } = await loadDrafts();
    const { storage } = fakeStorage();
    expect(() => clearDraft(storage, AT_NEW)).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. NOTHING THROWS, EVER.
 *
 * A draft store is read on mount. Anything it throws is thrown during the
 * editor's first render, and the owner sees an empty screen instead of the form
 * — the feature meant to protect their text destroying their access to it.
 * ════════════════════════════════════════════════════════════════════════ */

describe("a stored value the module cannot use", () => {
  /**
   * Every case is a thing a browser really produces: a value truncated by a tab
   * killed mid-write, a payload from a build whose shape has moved on, a field
   * someone hand-edited in devtools.
   */
  const HOSTILE: [name: string, raw: string][] = [
    ["not JSON at all", "{{{"],
    ["an empty string", ""],
    ["a truncated write", VALID_JSON.slice(0, VALID_JSON.length - 12)],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["an empty object", "{}"],
    ["the bare word undefined", "undefined"],
    ["a number", "42"],
    ["a string", '"a draft, honest"'],
    ["a missing field", JSON.stringify({ ...DRAFT, headline: undefined })],
    ["a field of the wrong type", JSON.stringify({ ...DRAFT, story: { value: "nested" } })],
    ["a null field", JSON.stringify({ ...DRAFT, slug: null })],
    ["a status this app does not have", JSON.stringify({ ...DRAFT, status: "archived" })],
    ["a travel mode this app does not have", JSON.stringify({ ...DRAFT, mode: "Teleport" })],
    // §6, and the reason it matters here rather than only on the Pod: savedAt
    // is rendered as the <time datetime> of the "unsaved draft" banner. Without
    // an offset it is not an instant, and the banner tells the owner the wrong
    // hour — which is the one fact that banner exists to carry.
    ["a savedAt with no offset", JSON.stringify({ ...DRAFT, savedAt: "2026-04-02T19:00:00" })],
    ["a savedAt that is not a date at all", JSON.stringify({ ...DRAFT, savedAt: "just now" })],
  ];

  it.each(HOSTILE)("%s: answers null and does not throw", async (_name, raw) => {
    const { draftKey, readDraft } = await loadDrafts();
    // The mutation really happened. Building these by spreading rather than by
    // string-replacing already makes a silent no-op unlikely, but this is the
    // failure mode this repository has actually shipped, so it is asserted.
    expect(raw).not.toBe(VALID_JSON);

    const { storage } = fakeStorage({ [draftKey(AT_NEW)]: raw });
    let back: Draft | null = DRAFT;
    expect(() => {
      back = readDraft(storage, AT_NEW);
    }).not.toThrow();
    expect(back).toBeNull();
  });

  it("the control: the same payload unmutated does read back", async () => {
    // THE ALLOW-CASE for the table above, which would otherwise be satisfied by
    // a readDraft that returns null unconditionally — a store that never
    // restores anything and never fails a test.
    const { draftKey, readDraft } = await loadDrafts();
    const { storage } = fakeStorage({ [draftKey(AT_NEW)]: VALID_JSON });
    expect(readDraft(storage, AT_NEW)).toEqual(DRAFT);
  });
});

describe("a storage that fails", () => {
  /** Storage disabled at the browser level: even reading throws. */
  it("readDraft answers null when getItem throws, and reads again when it stops", async () => {
    const { draftKey, readDraft } = await loadDrafts();
    const { storage, fail } = fakeStorage({ [draftKey(AT_NEW)]: VALID_JSON });

    fail.get = new DOMException("The operation is insecure.", "SecurityError");
    let back: Draft | null = DRAFT;
    expect(() => {
      back = readDraft(storage, AT_NEW);
    }).not.toThrow();
    expect(back).toBeNull();

    // The allow-case, through the same storage: the failure is the scripted one
    // and not "this module never reads anything".
    fail.get = null;
    expect(readDraft(storage, AT_NEW)).toEqual(DRAFT);
  });

  /**
   * Safari private mode. `writeDraft` must REPORT the failure rather than
   * propagate it: the editor turns that report into one quiet line saying this
   * browser is not keeping a local backup, which is information the owner can
   * act on — an exception out of a debounced timer is not.
   */
  it("writeDraft answers false when setItem throws, and true when it works", async () => {
    const { readDraft, writeDraft } = await loadDrafts();
    const { storage, items, fail } = fakeStorage();

    fail.set = QUOTA;
    let stored: boolean | undefined;
    expect(() => {
      stored = writeDraft(storage, AT_NEW, DRAFT);
    }).not.toThrow();
    expect(stored).toBe(false);
    // Nothing half-written was left behind for the next read to find.
    expect(items.size).toBe(0);
    expect(readDraft(storage, AT_NEW)).toBeNull();

    // THE ALLOW-CASE. A writeDraft that always answered false would satisfy
    // everything above and store nothing, ever.
    fail.set = null;
    expect(writeDraft(storage, AT_NEW, DRAFT)).toBe(true);
    expect(readDraft(storage, AT_NEW)).toEqual(DRAFT);
  });

  it("clearDraft is quiet when removeItem throws", async () => {
    const { clearDraft, writeDraft } = await loadDrafts();
    const { storage, fail } = fakeStorage();
    writeDraft(storage, AT_NEW, DRAFT);

    fail.remove = new DOMException("The operation is insecure.", "SecurityError");
    expect(() => clearDraft(storage, AT_NEW)).not.toThrow();
  });

  /**
   * A draft the module would refuse to read is a draft it must refuse to write.
   * Storing it instead is silent: the write reports success, the banner never
   * appears, and the owner believes there is a backup that cannot be restored.
   */
  it("writeDraft refuses a draft it could not read back, and stores nothing", async () => {
    const { readDraft, writeDraft } = await loadDrafts();
    const { storage, items } = fakeStorage();

    const bad = { ...DRAFT, savedAt: "2026-04-02T19:00:00" } as Draft;
    expect(writeDraft(storage, AT_NEW, bad)).toBe(false);
    expect(items.size).toBe(0);
    expect(readDraft(storage, AT_NEW)).toBeNull();

    // The allow-case: the same draft with the offset restored is accepted.
    expect(writeDraft(storage, AT_NEW, DRAFT)).toBe(true);
    expect(readDraft(storage, AT_NEW)).toEqual(DRAFT);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. THE PHOTOS A DRAFT CARRIES — and the version segment left alone.
 *
 * The only field here that is not a string off a form control, because by the
 * time one is in this list it is not a file any more: the editor uploads on
 * pick and holds a `Photo`. That ordering is what makes the local copy possible
 * at all — a `File` or a `Blob` serialises to `{}` through JSON without
 * throwing, so the write would report success and the restore would hand back a
 * photo with no URL on it.
 *
 * THE VERSION TEST, ANSWERED "NO" FOR THE FIRST TIME. `v1` → `v2` happened
 * because a v1 payload restored nine controls and left three showing the
 * editor's own defaults. Nothing like that can happen here: no `v2` payload can
 * contain a photo, because there was no control to attach one with. An empty
 * list is the truth about such a draft rather than a default standing in for
 * something lost — and a bump would have thrown away real unsaved prose in
 * exchange for nothing. The first test below is what holds that decision.
 * ════════════════════════════════════════════════════════════════════════ */

describe("the photos in a draft", () => {
  /** Exactly what `uploadPhoto` returns: URLs on the Pod, the web derivative's
   *  dimensions, the blob's real media type, and a `data:` placeholder that
   *  rides in JSON precisely because it is a string and not bytes. */
  const PHOTO = {
    contentUrl: "https://me.solidcommunity.net/travel/media/9f2b1c4d5e6a7b80/web.webp",
    thumbnailUrl: "https://me.solidcommunity.net/travel/media/9f2b1c4d5e6a7b80/thumb.webp",
    width: 1600,
    height: 1067,
    encodingFormat: "image/webp",
    blurDataUrl: "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  };

  it("round-trips a photo with everything the editor has to show again", async () => {
    const { readDraft, writeDraft } = await loadDrafts();
    const { storage } = fakeStorage();
    const withPhoto: Draft = { ...DRAFT, photos: [PHOTO] };

    expect(writeDraft(storage, AT_NEW, withPhoto)).toBe(true);
    const back = readDraft(storage, AT_NEW);
    // Field by field would let a missing thumbnail or a lost width through as a
    // pass; the whole object is what the editor renders from.
    expect(back).toEqual(withPhoto);
    expect(Object.keys(back!).sort()).toEqual(FIELDS);
  });

  /**
   * THE DECISION THE KEY DID NOT MOVE FOR. A payload written before the picker
   * existed is a v2 payload with no `photos`, and it must still restore its
   * prose — that is the whole point of not bumping.
   *
   * WHAT WOULD BREAK IT: making the field required (the draft becomes invisible
   * and the owner loses text the Pod never saw), or bumping the key to `v3`
   * (the same loss by a different route).
   */
  it("restores a draft written before photos existed, with an empty list", async () => {
    const { draftKey, readDraft } = await loadDrafts();
    const before = { ...DRAFT } as Partial<Draft>;
    delete before.photos;
    // The fixture really is missing the field, or the rest of this test is
    // about a payload that has one.
    expect(Object.keys(before)).not.toContain("photos");

    const { storage } = fakeStorage({ [draftKey(AT_NEW)]: JSON.stringify(before) });
    const back = readDraft(storage, AT_NEW);

    expect(back, "a draft written before the picker is no longer restorable").not.toBeNull();
    expect(back!.photos, "the missing field did not default to an empty list").toEqual([]);
    // The mutation half: the text the owner would lose really is in there.
    expect(back!.headline).toBe(DRAFT.headline);
    expect(back!.story).toBe(DRAFT.story);
  });

  /**
   * A HAND-EDITED PHOTO TAKES THE WHOLE PAYLOAD DOWN, exactly as a hand-edited
   * `status` does, and that asymmetry with "unknown keys are stripped" is the
   * point: losing one local draft is recoverable, and a mangled
   * `schema:contentUrl` on a world-readable resource is not.
   */
  it("refuses a draft whose photo is not a photo", async () => {
    const { draftKey, readDraft, writeDraft } = await loadDrafts();
    const { storage, items } = fakeStorage();

    const mangled = { ...DRAFT, photos: [{ ...PHOTO, contentUrl: "not a url" }] } as Draft;
    expect(writeDraft(storage, AT_NEW, mangled)).toBe(false);
    expect(items.size, "an unreadable draft was stored anyway").toBe(0);

    // And on the way back out, for a value that reached storage some other way.
    items.set(draftKey(AT_NEW), JSON.stringify(mangled));
    expect(readDraft(storage, AT_NEW)).toBeNull();

    // The allow-case, so this is not a reader that refuses everything.
    expect(writeDraft(storage, AT_NEW, { ...DRAFT, photos: [PHOTO] })).toBe(true);
    expect(readDraft(storage, AT_NEW)?.photos).toEqual([PHOTO]);
  });
});
