/**
 * The offset arithmetic behind `dy:occurredAt` (§7.3). No React and no DOM,
 * and out of `lib/studio` so the public timeline can reach it.
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
 * What the form holds → `xsd:dateTime` with an offset (§3, §6). THE WALL CLOCK
 * IS COPIED, NOT RECOMPUTED, and only the OFFSET is supplied — the one the
 * owner's own control is holding, with no fallback left on this line.
 * ./notes.md#the-wall-clock-is-copied-not-recomputed
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
 * This machine's clock, right now, as a wall clock with no offset on it. Split
 * out of `nowWithOffset` because `offsetHere("")` answers `+00:00` rather than
 * this machine's zone — measured. ./notes.md#wallclocknow-exists-because-offsethere-is-0000
 */
export function wallClockNow(): string {
  const at = new Date();
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/**
 * Now, with this machine's offset — the one instant a save is stamped with. A
 * moment in the owner's life rather than in the trip's, so unlike
 * `dy:occurredAt` it takes the offset of wherever the owner is sitting.
 * ./notes.md#wallclocknow-exists-because-offsethere-is-0000
 */
export function nowWithOffset(): string {
  const wall = wallClockNow();
  return `${wall}${offsetHere(wall)}`;
}

/**
 * THE OFFSETS ACTUALLY IN USE, west to east, and the odd ones are the point —
 * `+05:45`, `+08:45`, `+12:45`, `-09:30`, `+05:30`. Both halves of a zone's
 * year, `+00:00` and never `Z`, in order rather than sorted at use, and NO
 * COUNT: ./notes.md#the-offsets-actually-in-use-and-the-odd-ones-are-the-point
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
