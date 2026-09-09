import StudioClient from "@/components/studio/studio-client";
import { config } from "@/lib/config";
import { getOwnerProfile } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

/** Studio entry point: a thin server component, and thin on purpose. It reads
 *  the four values a browser cannot and hands them down; the `ssr: false` lives
 *  one file down, because Next 16 rejects it here. `getOwnerProfile()` and not
 *  `readOwnerProfile()`, or this page stops prerendering:
 *  ./notes.md#what-the-page-exists-to-do */
export default async function StudioPage() {
  const profile = await getOwnerProfile();

  /** No issuer, no sign-in: inventing a plausible one fails at the redirect, on
   *  the provider's own error page: ./notes.md#no-issuer-no-sign-in */
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
      /** `config.podRoot`, NEVER `process.env.POD_ROOT` — the getter is the only
       *  thing that appends the trailing slash — and NOT the owner's WebID:
       *  ./notes.md#podroot-is-configpodroot-and-is-not-the-owners-webid */
      podRoot={config.podRoot}
    />
  );
}
