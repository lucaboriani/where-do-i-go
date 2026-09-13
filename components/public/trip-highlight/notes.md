# components/public/trip-highlight — notes

## Why plain context is enough

The provider wraps the map's `<Suspense>` and `{children}` — siblings, both passed as elements
from the layout. When `raise`/`clear` change local state, `TripHighlightProvider` re-renders, but
`children` is the same element reference it was handed, so React skips any subtree under it that
does not itself call `useTripHighlight`. Only a component that actually consumes the context
re-renders, because context propagation ignores that same-element bailout for its consumers.

`trip-highlight.test.tsx`'s third case is the proof: a sibling that renders nothing and
consumes nothing stays at one render across a `raise`, while a sibling that consumes the context
re-renders every time. Mutation-tested by making the non-consuming sibling call
`useTripHighlight()` too — the case goes red, because a consumer can never rely on element
identity to skip a context-driven update.

That property is what makes a plain `createContext`/`useContext` pair affordable here instead of
a store with selectors: the map and the timeline can each read only the slice they need, and nodes
that read nothing pay nothing when the highlight moves.
