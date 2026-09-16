// The entry route's masthead: nothing. This segment MIRRORS the real
// [slug]/[entry] route so the slot resolves to null on a soft <Link> nav —
// a [...catchAll] does not. ../../notes.md#why-the-masthead-slot-mirrors-the-entry-route
export default function EntryMasthead() {
  return null;
}
