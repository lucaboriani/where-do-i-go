import type { NextConfig } from "next";

/**
 * Pod host for next/image. Without this, next/image refuses Pod-hosted photos.
 * Derived from POD_ROOT rather than hardcoded, because every deployer's Pod
 * lives somewhere different — and on Inrupt ESS, storage and identity are on
 * different hosts entirely (docs/phase-0-spike.md).
 */
function podImagePattern(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const root = process.env.POD_ROOT;
  if (!root) return [];
  let url: URL;
  try {
    url = new URL(root);
  } catch {
    throw new Error(`POD_ROOT is not a valid URL: ${root}`);
  }
  const protocol = url.protocol.replace(":", "");
  if (protocol !== "http" && protocol !== "https") {
    throw new Error(`POD_ROOT must be http or https, got: ${url.protocol}`);
  }
  return [{ protocol, hostname: url.hostname }];
}

const nextConfig: NextConfig = {
  // docs/decisions.md §22. Enabled from the first scaffold rather than
  // retrofitted; also makes Partial Prerendering the App Router default.
  cacheComponents: true,
  partialPrefetching: true,

  // This app is map- and browser-heavy and its worst failures — MapLibre and
  // Solid-OIDC — are invisible in server logs. CLAUDE.md requires this on.
  logging: { browserToTerminal: true },

  images: { remotePatterns: [...podImagePattern()] },
};

export default nextConfig;
