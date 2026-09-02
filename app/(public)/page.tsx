/**
 * Public home page. Phase 1 replaces this with the trip index, server-rendered
 * from the Pod via lib/pod/read.ts. Deliberately plain: the design brief is
 * applied in phase 7, and stock scaffolding styling is one of the most
 * recognisable generated-app looks (decisions.md §11).
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl">Travel diary</h1>
      <p className="mt-2 text-muted-foreground">
        Scaffolded, not implemented. See TODO.md phase 1.
      </p>
    </main>
  );
}
