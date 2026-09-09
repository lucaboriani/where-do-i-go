# studio/page — notes

The studio's entry point: a thin server component, and thin on purpose. Prose
moved here by Stage C's comment sweep on 2026-09-09.

## what the page exists to do

It exists to read the four values a browser cannot — `OWNER_WEBID`, `SITE_URL`,
`SITE_NAME` and `POD_ROOT` are not `NEXT_PUBLIC_`, and `lib/config.ts` throws if
it is reached from the client — plus the owner's identity provider, and to hand
all five down as props.

The `ssr: false` that keeps the Solid session out of the server lives one file
down, in `components/studio/studio-client/studio-client.tsx`: Next 16 rejects it
here ("`ssr: false` is not allowed with `next/dynamic` in Server Components").

`getOwnerProfile()` and not `readOwnerProfile()`: this page prerenders as
`○ (Static)`, and with Cache Components on, an uncached data access outside a
Suspense boundary silently demotes it (`decisions.md` §22). Only the build's
route table would show that.

§7.5: the issuer comes out of the owner's WebID document, not an env var. There
is deliberately no `OIDC_ISSUER` — the WebID reliably carries
`solid:oidcIssuer`, and one fewer thing to configure is the point.

## no issuer, no sign-in

`session.login()` makes `oidcIssuer` mandatory, and inventing a plausible one
would not fail on this page — it would fail at the redirect, on the identity
provider's own error page, with nothing pointing back at this read. So say what
could not be read and stop.

## podRoot is config.podRoot, and is not the owner's WebID

Never `process.env.POD_ROOT`: the getter is the only thing that appends the
trailing slash, and every URL in `lib/studio/trips.ts` is built with
`new URL("travel/trips/", podRoot)`, which without it resolves against the
PARENT.

It travels as a prop for the reason the three config values above do — it is not
`NEXT_PUBLIC_` and `required()` throws the moment it is reached in a browser.
Everything below this page runs inside `ssr: false`, so if this page does not
pass it, nothing can, and the owner is shown the "no trips" note on a Pod full
of trips.

It is **not** the owner's WebID: on ESS identity and storage are different hosts
entirely (§7.5).
