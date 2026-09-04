import StudioClient from "@/components/studio/studio-client";
import { config } from "@/lib/config";
import { getOwnerProfile } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

/**
 * Studio entry point: a thin server component, and thin on purpose.
 *
 * It exists to read the three values a browser cannot — OWNER_WEBID, SITE_URL
 * and SITE_NAME are not `NEXT_PUBLIC_`, and lib/config.ts throws if it is
 * reached from the client — plus the owner's identity provider, and to hand all
 * four down as props. The `ssr: false` that keeps the Solid session out of the
 * server lives one file down, in components/studio/studio-client.tsx: Next 16
 * rejects it here ("`ssr: false` is not allowed with `next/dynamic` in Server
 * Components").
 *
 * `getOwnerProfile()` and not `readOwnerProfile()`: this page prerenders as
 * `○ (Static)`, and with Cache Components on, an uncached data access outside a
 * Suspense boundary silently demotes it (decisions.md §22). Only the build's
 * route table would show that.
 *
 * §7.5: the issuer comes out of the owner's WebID document, not an env var.
 * There is deliberately no OIDC_ISSUER — the WebID reliably carries
 * `solid:oidcIssuer`, and one fewer thing to configure is the point.
 */
export default async function StudioPage() {
  const profile = await getOwnerProfile();

  /**
   * No issuer, no sign-in. `session.login()` makes `oidcIssuer` mandatory, and
   * inventing a plausible one would not fail here — it would fail at the
   * redirect, on the identity provider's own error page, with nothing pointing
   * back at this read. So say what could not be read and stop.
   */
  if (!profile.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl">{`${config.siteName} — studio`}</h1>
        <p className="mt-2">
          {"The studio cannot open: this diary's WebID could not be read, so there is no " +
            "identity provider to sign in to."}
        </p>
        <p className="mt-2 text-muted-foreground">{describe(profile.error)}</p>
        <p className="mt-2 text-muted-foreground">
          {`Configured owner WebID: ${config.ownerWebId}`}
        </p>
      </main>
    );
  }

  return (
    <StudioClient
      ownerWebId={config.ownerWebId}
      oidcIssuer={profile.value.oidcIssuer}
      siteUrl={config.siteUrl}
      siteName={config.siteName}
    />
  );
}
