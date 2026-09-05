/**
 * Deployment configuration. Every value is an env var with no secret in it —
 * "zero required API keys" is a product feature, not a preference (invariant 6).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in — ` +
        `the site reads its content from a Solid Pod and cannot start without knowing which one.`,
    );
  }
  return value;
}

export const config = {
  /** Storage root, always with a trailing slash so URL joins behave. */
  get podRoot() {
    const root = required("POD_ROOT");
    return root.endsWith("/") ? root : `${root}/`;
  },
  get ownerWebId() {
    return required("OWNER_WEBID");
  },
  get siteName() {
    return process.env.SITE_NAME ?? "Travel diary";
  },
  /** §6: human-readable text is language-tagged, "with a configurable default
   *  language". Used when writing, so a diary kept in another language is not
   *  silently tagged @en. */
  get defaultLanguage() {
    return process.env.SITE_LANGUAGE ?? "en";
  },
  /**
   * The site's public origin, always WITHOUT a trailing slash — the mirror of
   * podRoot above, which always adds one. Both normalise here so that no
   * consumer has to remember which way round it is.
   *
   * Every consumer joins a path onto this, so a pasted `https://diary.example/`
   * would otherwise produce `https://diary.example//studio`. That is cosmetic
   * in a sitemap and is not cosmetic at all in the Solid-OIDC client ID
   * document: the identity provider fetches the client_id URL it is given, and
   * a doubled slash is a different URL, so it cannot match the document and
   * falls back to dynamic client registration — a login that still works while
   * showing a bare UUID on the consent screen (phase 0). .env.example does not
   * say to omit the slash, and a human pasting an origin includes it.
   */
  get siteUrl() {
    const url = process.env.SITE_URL ?? "http://localhost:3000";
    return url.replace(/\/+$/, "");
  },
};
