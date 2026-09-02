/**
 * Static Solid-OIDC client identifier document, served from the app's own
 * origin. Generated from config rather than hardcoded, because every deployer
 * serves it from their own domain.
 *
 * Phase 0 finding: the identity provider fetches this URL, so it must be
 * publicly reachable. It therefore cannot be exercised from localhost against a
 * hosted Pod — dynamic client registration is the fallback there, and it shows
 * a bare UUID on the consent screen instead of the app name.
 */
import { OIDC_CONTEXT } from "@/lib/vocab";

export async function GET() {
  const origin = process.env.SITE_URL;
  if (!origin) {
    return new Response("SITE_URL is not set", { status: 500 });
  }
  return Response.json(
    {
      "@context": [OIDC_CONTEXT],
      client_id: `${origin}/client-id.jsonld`,
      client_name: process.env.SITE_NAME ?? "Travel diary",
      redirect_uris: [`${origin}/studio`],
      post_logout_redirect_uris: [`${origin}/`],
      application_type: "web",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid profile offline_access webid",
      token_endpoint_auth_method: "none",
    },
    { headers: { "content-type": "application/ld+json" } },
  );
}
