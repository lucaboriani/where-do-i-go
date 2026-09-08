/**
 * The offset arithmetic behind `dy:occurredAt` (§7.3). No React and no DOM:
 * phase 4's timeline wants this without wanting a form.
 * Why it left the editor: ./notes.md#tested-through-the-dom-until-now
 */

export const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="datetime-local">` hands back exactly this, with the seconds
 *  optional and no offset at all. */
export const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
export const TRAILING_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

/** The UTC offset this machine is on at that wall-clock time, `+09:00`-shaped.
 *  Computed AT the instant in question so a summer date gets the summer offset. */
export function offsetHere(wall: string): string {
  const at = new Date(wall);
  const minutes = Number.isNaN(at.getTime()) ? 0 : -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const size = Math.abs(minutes);
  return `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/**
 * What the form holds → `xsd:dateTime` with an offset (§3, §6).
 *
 * THE WALL CLOCK IS COPIED, NOT RECOMPUTED. §7.3: `dy:occurredAt` "carries the
 * local UTC offset of the place", so "21:40+09:00" renders as half past nine in
 * the evening for every reader. Converting through a `Date` and back would
 * rewrite an entry edited from another time zone into that zone's offset — the
 * same instant, spelled as the wrong time of day, which for a travel diary is
 * most of the meaning. So only the OFFSET is supplied here, and it is the one
 * the owner's own control is holding.
 *
 * THE OFFSET IS REQUIRED, AND THE FALLBACK THAT USED TO BE ON THIS LINE HAS
 * MOVED RATHER THAN GONE. It read `storedOffset ?? offsetHere(wall)` — the
 * entry's own offset, else the EDITING MACHINE'S — which is the guess the
 * offset control exists to replace, and it fired where nobody could see it. The
 * same chain is now the control's INITIAL VALUE, where the owner can read it
 * and correct it. Keeping a copy here as well would be a second chain that has
 * to agree with the first and says nothing when it stops: the rule §9 step 3
 * states for the precision — what the control shows is what gets applied —
 * spelled for the offset.
 */
export function toOffsetDateTime(local: string, offset: string): string | undefined {
  const parts = LOCAL_DATETIME.exec(local);
  if (!parts) return undefined;
  const wall = `${parts[1]}T${parts[2]}${parts[3] ?? ":00"}`;
  return `${wall}${offset}`;
}

/** The offset an already-stored timestamp carries. `Z` is a valid offset and
 *  means the same as `+00:00`; everything this app writes uses the latter. */
export function offsetOf(value: string | undefined): string | undefined {
  const found = value === undefined ? null : TRAILING_OFFSET.exec(value);
  if (found === null) return undefined;
  return found[1] === "Z" ? "+00:00" : found[1];
}

/** `2026-03-29T21:40:00+09:00` → `2026-03-29T21:40`, which is what the control
 *  accepts. The wall clock is shown as stored, never shifted into this
 *  machine's zone — see toOffsetDateTime. */
export const wallClockOf = (value: string | undefined) => (value === undefined ? "" : value.slice(0, 16));

/**
 * This machine's clock, right now, as a wall clock with no offset on it.
 *
 * SPLIT OUT OF `nowWithOffset` FOR THE OFFSET CONTROL'S INITIAL VALUE, which
 * needs the offset of the current instant and has no wall clock of its own to
 * ask about: `occurred` is `""` on a create, and `offsetHere("")` is `+00:00`
 * rather than this machine's zone — measured, not reasoned about, because
 * `offsetHere` treats an unparseable date as zero minutes. A new entry
 * defaulting to UTC while the owner sits in Tokyo is the exact silent
 * wrong-offset bug the control exists to remove.
 */
export function wallClockNow(): string {
  const at = new Date();
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/**
 * Now, with this machine's offset — the one instant a save is stamped with:
 * `dcterms:created` on a create, `schema:datePublished` on a first publication,
 * and, through `saveEntry`'s `now`, `dcterms:modified` on the entry and its
 * index row.
 *
 * These are moments in the owner's life rather than in the trip's, so unlike
 * `dy:occurredAt` they take the offset of wherever the owner is sitting.
 */
export function nowWithOffset(): string {
  const wall = wallClockNow();
  return `${wall}${offsetHere(wall)}`;
}

/**
 * THE OFFSETS ACTUALLY IN USE, west to east, and the odd ones are the point.
 *
 * `+05:45` is Nepal, `+08:45` is Eucla, `+12:45` is the Chathams, `-09:30` is
 * the Marquesas, `+05:30` is India. A list of whole hours makes those places
 * unwritable, which for a travel diary is the wrong corner to cut, and it is
 * also why this is a `<select>` over a fixed list rather than a stepper: a
 * numeric control that admits `+05:45` admits `+05:61` with it.
 *
 * BOTH HALVES OF A ZONE'S YEAR, AND THIS LIST WAS WRONG ON THAT TWICE OVER
 * UNTIL 2026-09-07 (F2). `-02:30` is Newfoundland DAYLIGHT Time, May to
 * November, and `-03:30` — the same island in the other half of its year — was
 * already here. `+13:45` is Chatham DAYLIGHT Time, September to April, beside
 * the `+12:45` the paragraph above names as one of the odd ones the list exists
 * for. So two of the places argued for were writable for half a year each, and
 * the cost is not a wall clock — §7.3's guarantee survives: the owner writing
 * up the Chathams in January picks the nearest offered value and the INSTANT is
 * an hour out, which is what any cross-trip ordering uses. Nothing on screen
 * says so, and `offsetOptions`' union cannot rescue it either, because on a
 * create there is no stored value and no photo to supply one.
 *
 * "ACTUALLY IN USE" IS A MEASURED CLAIM AS OF THAT DATE, AND THE WAY IT WAS
 * WRONG IS WORTH MORE THAN THE TWO STRINGS. Task 2's review verified this list
 * programmatically *against the brief text*, so the brief was the oracle rather
 * than the world — and neither could name a value neither of them knew about.
 * The oracle is the set of offsets in real civil use, daylight ones included;
 * the durable form of the claim is `ODD_OFFSETS` in components/studio/entry-editor/entry-editor.test.tsx,
 * which lists the non-whole-hour zones and goes red if one stops being offered.
 * A COUNT IS NOT THE CLAIM, so there is none here: the length moved the moment
 * these two were added and it moves again the next time a legislature moves a
 * zone.
 *
 * `+00:00`, NEVER `Z`. Both are valid `xsd:dateTime` offsets and mean the same
 * instant, but §6 and lib/pod/rdf.ts want the explicit spelling and `offsetOf`
 * normalises a stored `Z` onto it — so a list offering `Z` would be a second
 * spelling of one value, and the control would blank on every entry written
 * with the other one.
 *
 * IN ORDER, RATHER THAN SORTED AT USE. The strings do not sort into this order:
 * `-` precedes `+` in ASCII, so a string sort puts the western hemisphere first
 * and then orders it backwards, `-01:00` before `-12:00`. `offsetMinutes` below
 * is the comparator for the one case that cannot be written out here — an
 * offset the entry carries that is not on this list.
 */
export const OFFSETS = [
  "-12:00", "-11:00", "-10:00", "-09:30", "-09:00", "-08:00", "-07:00",
  "-06:00", "-05:00", "-04:00", "-03:30", "-03:00", "-02:30", "-02:00",
  "-01:00", "+00:00", "+01:00", "+02:00", "+03:00", "+03:30", "+04:00",
  "+04:30", "+05:00", "+05:30", "+05:45", "+06:00", "+06:30", "+07:00",
  "+08:00", "+08:45", "+09:00", "+09:30", "+10:00", "+10:30", "+11:00",
  "+12:00", "+12:45", "+13:00", "+13:45", "+14:00",
] as const;

/** What an offset has to LOOK like to be one, which is a wider fence than
 *  `OFFSETS` on purpose: `+05:15` is not a zone anyone uses today and an entry
 *  can still carry it, because some other tool wrote it. This editor's job is
 *  to show such a value and put it back unchanged — so the shape is what is
 *  checked, and the list is only what is OFFERED. */
export const OFFSET_SHAPE = /^[+-]\d{2}:\d{2}$/;

/** `+05:45` → 345, `-09:30` → -570. A sort key and nothing else: no triple
 *  carries minutes, and `toOffsetDateTime` concatenates the string itself. */
export function offsetMinutes(offset: string): number {
  const sign = offset.startsWith("-") ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
}
