import StudioClient from "@/components/studio/studio-client";
import { config } from "@/lib/config";
import { getOwnerProfile } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

/** Every studio route is client-only (`ssr: false`) and behind a Pod-enforced
 *  session, so there is no static shell worth prerendering here — reading
 *  `params` below is otherwise flagged as blocking one.
 *  node_modules/next/dist/docs/.../route-segment-config/instant.md */
export const instant = false;

/** EDIT ENTRY mode: the shell loads this trip's entry and mounts the editor on
 *  it. Thin, mirroring `/studio/trips/[slug]/page.tsx` — both route params are
 *  the one thing this page reads from itself rather than from config. */
export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ slug: string; entry: string }>;
}) {
  const { slug, entry } = await params;
  const profile = await getOwnerProfile();

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
      podRoot={config.podRoot}
      editEntry={{ tripSlug: slug, entrySlug: entry }}
    />
  );
}
