/** Static Solid-OIDC client identifier document, served from the app's own
 *  origin and generated from config, because every deployer serves it from their
 *  own domain. It cannot be exercised from localhost against a hosted Pod:
 *  ./notes.md#it-is-generated-from-config-and-cannot-be-exercised-from-localhost */
import { config } from "@/lib/config";
import { OIDC_CONTEXT } from "@/lib/vocab";

export async function GET() {
  // THE PRESENCE CHECK STAYS ON THE RAW ENV VAR; THE VALUE COMES FROM CONFIG.
  // An unset SITE_URL is a deployment error and stays a loud 500; the value goes
  // through config.siteUrl, which is where the trailing slash is normalised away.
  // ./notes.md#the-presence-check-stays-on-the-raw-env-var-the-value-comes-from-config
  if (!process.env.SITE_URL) {
    return new Response("SITE_URL is not set", { status: 500 });
  }
  const origin = config.siteUrl;
  return Response.json(
    {
      "@context": [OIDC_CONTEXT],
      client_id: `${origin}/client-id.jsonld`,
      client_name: config.siteName,
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
