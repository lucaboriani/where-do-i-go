// Matches every route deeper than /trips/[slug] (the entry route, chiefly),
// on client-side <Link> nav too — default.tsx alone only covers a hard
// reload. ../../notes.md#why-the-masthead-catch-all-needs-instant-false
export const instant = false;

export default function CatchAll() {
  return null;
}
