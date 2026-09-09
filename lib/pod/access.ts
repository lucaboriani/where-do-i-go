/**
 * The ONLY module in this codebase that touches access control, and
 * `no-restricted-imports` bans the ACL primitives everywhere else.
 * ./notes.md#accessts-is-the-only-module-that-touches-access-control
 */

// DO NOT DETECT THE MECHANISM AND BRANCH ON IT (decisions §19). The one branch
// here is on the resource kind, and the container path REFUSES rather than
// guesses. ./notes.md#document-versus-container-is-the-only-branch-and-never-the-server

// Every method verifies the RESULT rather than the status code, and NEITHER
// KIND OF EVIDENCE IS PROOF OF ENFORCEMENT: the only proof is a request from
// the context that should be denied, which this module cannot make.
// ./notes.md#two-kinds-of-evidence-and-neither-is-proof-of-enforcement
import {
  createAclFromFallbackAcl,
  FetchError,
  getAgentResourceAccessAll,
  getEffectiveAccess,
  getPublicDefaultAccess,
  getPublicResourceAccess,
  getResourceAcl,
  getResourceInfo,
  getResourceInfoWithAcl,
  getSourceUrl,
  hasAccessibleAcl,
  hasFallbackAcl,
  hasResourceAcl,
  responseToSolidDataset,
  setAgentDefaultAccess,
  setAgentResourceAccess,
  setPublicDefaultAccess,
  setPublicResourceAccess,
  solidDatasetAsTurtle,
  universalAccess,
  type Access,
  type AclDataset,
  type WithServerResourceInfo,
} from "@inrupt/solid-client";
import { LDP } from "@/lib/vocab";
import type { PodFetch } from "./rdf";
import { err, ok, type PodError, type Result } from "./result";
import { putGuarded, type Precondition } from "./write";

/* --------------------------------------------------------------------- types */

/** The visitor's own session, held only in their browser (invariant 4). Never
 *  optional: a default to the ambient fetch is a silent downgrade to anonymous,
 *  which on ESS is indistinguishable from a missing resource (phase 0). */
export type AccessOptions = {
  fetch: PodFetch;
  /** The owner, when the caller knows it. Used only to keep an agent with
   *  Control in an ACL this module rewrites — never to decide authorisation,
   *  which is the Pod's job and only the Pod's. */
  webId?: string;
};

export type CreateContainerOptions = AccessOptions & {
  /** Whether the public may read the resources INSIDE. The container's own
   *  listing is never public, on any setting. Defaults to true: everything
   *  under `travel/` is a public diary. Pass false for a container whose
   *  children are private, e.g. `media-private/` (§4). */
  publicChildren?: boolean;
};

/** What a logged-out reader gets on this exact resource. For a container that
 *  means the listing, which this module deliberately keeps closed. */
export type PublicAccess = {
  url: string;
  read: boolean;
  append: boolean;
  write: boolean;
  /**
   * How `read`/`append`/`write` were established: "server" is the WAC-Allow
   * header, "rules" is what is stored. NEITHER VALUE PROVES ENFORCEMENT — do
   * not render either as a guarantee to the owner.
   * ./notes.md#two-kinds-of-evidence-and-neither-is-proof-of-enforcement
   */
  verifiedBy: "server" | "rules";
};

export type AccessState = PublicAccess & {
  /** Containers only: does public read reach the resources inside? This is the
   *  half that makes a diary readable, and the half a 2xx never proves. */
  inherits: boolean;
  /**
   * How `inherits` was established — deliberately NOT the same field as
   * `verifiedBy`, because it can never be as strong. No server header answers
   * "what would an anonymous request to a CHILD get?".
   * ./notes.md#two-kinds-of-evidence-and-neither-is-proof-of-enforcement
   */
  inheritsVerifiedBy: "rules" | "notApplicable";
};

export type InitReport = {
  podRoot: string;
  containers: AccessState[];
};

/* ------------------------------------------------------------------- helpers */

const PUBLIC_NOTHING: Access = { read: false, append: false, write: false, control: false };
const PUBLIC_READ: Access = { read: true, append: false, write: false, control: false };
const OWNER_FULL: Access = { read: true, append: true, write: true, control: true };

/**
 * The §4 layout, with what the public may read inside each one.
 * `travel/settings/` IS THE ONE WITH `publicChildren: false`, and that flag is
 * why it is created at first run: its safe state is not the state it arrives in.
 * ./notes.md#the-4-containers-and-why-travelsettings-is-created-at-first-run
 */
const CONTAINERS: ReadonlyArray<{ segment: string; publicChildren: boolean }> = [
  { segment: "travel/", publicChildren: true },
  { segment: "travel/trips/", publicChildren: true },
  { segment: "travel/media/", publicChildren: true },
  { segment: "travel/settings/", publicChildren: false },
];

/** Report the URL the CALLER asked about, not the URL that happened to fail —
 *  both alternatives name a resource the caller never mentioned;
 *  see ./notes.md#report-the-url-the-caller-asked-about-not-the-url-that-failed */
function toPodError(url: string, cause: unknown): PodError {
  if (cause instanceof FetchError) return { kind: "http", url, status: cause.response.status };
  return { kind: "network", url, message: cause instanceof Error ? cause.message : String(cause) };
}

/** The same rule for an error that arrived already structured: a failure on a
 *  resource's control document is a failure ABOUT the resource, and the caller
 *  has no name for `{container}.acl` — it never asked for one, and on another
 *  server the control document is somewhere else entirely. */
function about(url: string, error: PodError): PodError {
  return { ...error, url };
}

const unverified = (url: string, expected: string, found: string): PodError => ({
  kind: "accessUnverified",
  url,
  expected,
  found,
});

/** LDP's own convention, and what @inrupt/solid-client's isContainer checks:
 *  a trailing slash. Not a server capability, so this is not a mechanism
 *  branch — it is the difference between "a thing" and "a place things are in". */
const isContainerUrl = (url: string) => url.endsWith("/");

/**
 * The server's own answer to "what would an unauthenticated request get?",
 * from the WAC-Allow header. `undefined` when the server did not say — which is
 * a different fact from "nothing", and is reported as such rather than as
 * `read: false`.
 */
function serverPublicAccess(
  resource: WithServerResourceInfo,
): { read: boolean; append: boolean; write: boolean } | undefined {
  const effective = getEffectiveAccess(resource);
  return "public" in effective ? effective.public : undefined;
}

/* ------------------------------------------------------- containers, created */

/**
 * Create a container if it is not already there. Idempotent (§5), and the
 * create still carries `If-None-Match: *` — a 412 is the success case here.
 * Private on purpose, so callers go through `createContainer`.
 * ./notes.md#ensurecontainer-is-idempotent-and-still-carries-a-precondition
 */
async function ensureContainer(fetch: PodFetch, url: string): Promise<Result<"created" | "existed">> {
  let head: Response;
  try {
    head = await fetch(url, { method: "HEAD" });
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (head.ok) return ok("existed");

  const created = await putGuarded(fetch, url, "", { create: true }, "text/turtle", {
    link: `<${LDP.BasicContainer}>; rel="type"`,
  });
  if (created.ok) return ok("created");
  if (created.error.kind === "http" && (created.error.status === 412 || created.error.status === 409)) {
    return ok("existed");
  }
  return err(created.error);
}

/**
 * Create a container AND give it its own access control, as ONE operation: a
 * container with no ACL of its own has a PUBLIC LISTING, measured on CSS 7.2.0.
 * NO CODE IN THIS PROJECT CREATES A CONTAINER ANY OTHER WAY.
 * ./notes.md#createcontainer-is-one-operation-because-the-halves-cannot-be-separate
 */
export async function createContainer(
  url: string,
  opts: CreateContainerOptions,
): Promise<Result<AccessState>> {
  if (!isContainerUrl(url)) {
    // Not a throw (§11: results, not exceptions) and not a silent normalisation
    // either: appending the slash would create a container at a URL the caller
    // did not name, and the caller's other references would point at a document
    // that does not exist.
    return err(unverified(url, "a container URL, ending in '/'", "a URL with no trailing slash"));
  }
  const created = await ensureContainer(opts.fetch, url);
  if (!created.ok) return err(about(url, created.error));
  return setContainerAccess(url, opts, opts.publicChildren ?? true);
}

/* ------------------------------------------------ containers, access control */

/**
 * Read a control document as an ACL, keeping the ETag OF THE SAME RESPONSE. The
 * point is the pairing: an ETag from a later HEAD says nothing about the body
 * being edited, and would satisfy `If-Match` over someone else's change.
 * ./notes.md#readacl-keeps-the-etag-of-the-same-response
 */
async function readAcl(
  fetch: PodFetch,
  aclUrl: string,
  accessTo: string,
  reportAs: string,
): Promise<Result<{ acl: AclDataset; etag: string | null }>> {
  let res: Response;
  try {
    res = await fetch(aclUrl, { headers: { accept: "text/turtle" } });
  } catch (cause) {
    return err(toPodError(reportAs, cause));
  }
  if (!res.ok) return err({ kind: "http", url: reportAs, status: res.status });

  const etag = res.headers.get("etag");
  try {
    const dataset = await responseToSolidDataset(res);
    return ok({ acl: { ...dataset, internal_accessTo: accessTo }, etag });
  } catch (cause) {
    return err({
      kind: "parse",
      url: reportAs,
      message: `${aclUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/**
 * Step 1 of the container write: the ACL to edit and the precondition to write
 * it under. Three answers — its own, an ancestor's copied, or a refusal; the
 * module docblock argues for refusing rather than guessing, and an ACL that
 * could not be READ is not one of the three: ./notes.md#an-unreadable-acl-looks-exactly-like-no-acl
 */
export async function resolveContainerAcl(
  fetch: PodFetch,
  url: string,
): Promise<Result<{ acl: AclDataset; aclUrl: string; precondition: Precondition }>> {
  let withAcl: Awaited<ReturnType<typeof getResourceInfoWithAcl>>;
  try {
    withAcl = await getResourceInfoWithAcl(url, { fetch });
  } catch (cause) {
    return err(toPodError(url, cause));
  }

  let acl: AclDataset;
  let aclUrl: string;
  let precondition: Precondition;

  if (hasResourceAcl(withAcl)) {
    // Positive evidence #1: an ACL document exists at the advertised URL and
    // parsed as WAC rules governing this exact resource. Re-read it in one GET
    // so the body and the ETag are the same response (see readAcl).
    aclUrl = getSourceUrl(getResourceAcl(withAcl));
    const current = await readAcl(fetch, aclUrl, getSourceUrl(withAcl), url);
    if (!current.ok) return err(current.error);
    if (current.value.etag === null) {
      // `If-Match: *` here would be a blind PUT wearing a precondition: it
      // succeeds against whatever is there now, which is the overwrite §10
      // forbids. Refusing costs the caller a retry; degrading costs an edit.
      return err(
        unverified(
          url,
          "an ETag on the container's control document, to write under If-Match (§10)",
          "the server returned none, so a safe update cannot be expressed",
        ),
      );
    }
    acl = current.value.acl;
    precondition = { etag: current.value.etag };
  } else if (hasFallbackAcl(withAcl) && hasAccessibleAcl(withAcl)) {
    // Positive evidence #2: no ACL of its own, but an ancestor's WAC ACL was
    // fetched and parsed. hasAccessibleAcl appears here ONLY as the type guard
    // the library requires for aclUrl to be a string — never as evidence.
    // ./notes.md#document-versus-container-is-the-only-branch-and-never-the-server
    acl = createAclFromFallbackAcl(withAcl);
    aclUrl = getSourceUrl(acl);
    precondition = { create: true };
  } else {
    return err(
      unverified(
        url,
        "WAC authorisations this caller can read — the container's own, or an ancestor's",
        "neither; the server exposes no readable ACL document (an ACP control resource, or no Control for this caller)",
      ),
    );
  }

  return ok({ acl, aclUrl, precondition });
}

/**
 * Step 2: the rules themselves, on the dataset step 1 resolved. Pure — it
 * neither reads nor writes, so what it refuses it refuses before anything
 * leaves the machine. Exported for its own tests.
 */
export function applyContainerRules(
  url: string,
  resolved: AclDataset,
  webId: string | undefined,
  publicInherit: boolean,
): Result<AclDataset> {
  let acl = resolved;

  // The owner, if the caller named one. Nothing else is carried over by hand:
  // in step 1 either the ACL already holds every existing rule, or
  // createAclFromFallbackAcl copied them — including the agent-class and group
  // rules an agent-by-agent carry-over would have dropped, and without the
  // widening that comes of turning an accessTo-only rule into a default one.
  if (webId) {
    acl = setAgentResourceAccess(acl, webId, OWNER_FULL);
    acl = setAgentDefaultAccess(acl, webId, OWNER_FULL);
  }

  // The two halves of §20's fix. `default` without `accessTo`: children stay
  // readable, the listing closes, the authenticated studio still enumerates.
  acl = setPublicDefaultAccess(acl, publicInherit ? PUBLIC_READ : PUBLIC_NOTHING);
  acl = setPublicResourceAccess(acl, PUBLIC_NOTHING);

  // Refuse to write an ACL that locks everyone out of it: on WAC an ACL with no
  // Control rule cannot be repaired through the API that wrote it. Asked of the
  // document about to be written, not of the server, and an agent CLASS does
  // not count. ./notes.md#an-acl-with-no-control-rule-is-refused
  const controllers = Object.values(getAgentResourceAccessAll(acl)).filter((a) => a.control);
  if (controllers.length === 0) {
    return err(
      unverified(
        url,
        "an agent keeping Control in the authorisations about to be written",
        "none; writing this would make the container's access unrepairable",
      ),
    );
  }

  return ok(acl);
}

/**
 * Step 3. The control document is a resource, so §10's write protocol applies
 * to it too: `If-Match: <etag>` to update, `If-None-Match: *` to create. There
 * is no third case, and no degrading to `*`. Failures are reported ABOUT the
 * container, never about `{container}.acl`. Exported for its own tests.
 */
export async function putAcl(
  fetch: PodFetch,
  url: string,
  aclUrl: string,
  acl: AclDataset,
  precondition: Precondition,
): Promise<Result<{ etag: string | null }>> {
  let body: string;
  try {
    body = await solidDatasetAsTurtle(acl);
  } catch (cause) {
    return err({
      kind: "parse",
      url,
      message: `${aclUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }

  const written = await putGuarded(fetch, aclUrl, body, precondition);
  return written.ok ? written : err(about(url, written.error));
}

/**
 * Write the container shape: public read that reaches the children, and a
 * listing that stays shut. `publicInherit: false` is the same shape with the
 * public grant removed, which universalAccess CANNOT express — verified.
 * ./notes.md#makeprivate-on-a-container-cannot-go-through-universalaccess
 */
async function setContainerAccess(
  url: string,
  opts: AccessOptions,
  publicInherit: boolean,
): Promise<Result<AccessState>> {
  const { fetch } = opts;

  const resolved = await resolveContainerAcl(fetch, url);
  if (!resolved.ok) return err(resolved.error);
  const { aclUrl, precondition } = resolved.value;

  const ruled = applyContainerRules(url, resolved.value.acl, opts.webId, publicInherit);
  if (!ruled.ok) return err(ruled.error);

  const written = await putAcl(fetch, url, aclUrl, ruled.value, precondition);
  if (!written.ok) return err(written.error);

  return verifyContainerAccess(url, fetch, publicInherit);
}

/**
 * The "rules" evidence: the stored authorisations against what was asked for.
 * Weak on its own — it proves the write persisted as written, and nothing about
 * enforcement. Pure, and exported for its own tests: the verify step only ever
 * sees an ACL it just wrote, so the leak it names is reachable no other way.
 */
export function storedRulesContradiction(
  url: string,
  acl: AclDataset,
  publicInherit: boolean,
): PodError | undefined {
  const inherited = getPublicDefaultAccess(acl);
  const direct = getPublicResourceAccess(acl);

  if (inherited.read !== publicInherit) {
    return unverified(
      url,
      `public read ${publicInherit ? "reaching" : "removed from"} the resources inside`,
      `acl:default read=${inherited.read}`,
    );
  }
  // "Public read, owner-only write" is the defining constraint (§5). Read
  // granted one mode too wide is not a smaller bug.
  if (inherited.write || inherited.append || inherited.control || direct.write || direct.append || direct.control) {
    return unverified(url, "no public write anywhere on this container", "a public write grant");
  }
  if (direct.read) {
    return unverified(url, "a closed listing (no public acl:accessTo)", "public read on the container itself");
  }
  return undefined;
}

/**
 * The "server" evidence, and the only check here that is not "what we stored":
 * an enumerable listing in spite of the rules means public draft slugs.
 * `undefined` in means the server said nothing — a different fact from
 * "nothing", and never a contradiction.
 */
export function serverListingContradiction(
  url: string,
  server: ReturnType<typeof serverPublicAccess>,
): PodError | undefined {
  if (!server || !(server.read || server.write || server.append)) return undefined;
  return unverified(
    url,
    "the server to report no public access to the container itself",
    `WAC-Allow public read=${server.read} append=${server.append} write=${server.write}`,
  );
}

/** Read the access back. A 2xx on the write above is not evidence (phase 0). */
async function verifyContainerAccess(
  url: string,
  fetch: PodFetch,
  publicInherit: boolean,
): Promise<Result<AccessState>> {
  let back: Awaited<ReturnType<typeof getResourceInfoWithAcl>>;
  try {
    back = await getResourceInfoWithAcl(url, { fetch });
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (!hasResourceAcl(back)) {
    return err(unverified(url, "the container's own authorisations", "none, after writing them"));
  }

  const stored = storedRulesContradiction(url, getResourceAcl(back), publicInherit);
  if (stored) return err(stored);

  const server = serverPublicAccess(back);
  const reported = serverListingContradiction(url, server);
  if (reported) return err(reported);

  return ok({
    url,
    read: false,
    append: false,
    write: false,
    inherits: publicInherit,
    inheritsVerifiedBy: "rules",
    verifiedBy: server ? "server" : "rules",
  });
}

/* -------------------------------------------------- documents, access control */

/**
 * The apply half of the document write, and the "rules" evidence with it: what
 * universalAccess reports back is the authorisations it stored, which is not
 * enforcement. Every refusal on this path is decided here, before the caller's
 * cross-check runs. Exported for its own tests.
 */
export async function applyDocumentPublicRead(
  url: string,
  fetch: PodFetch,
  read: boolean,
): Promise<Result<null>> {
  let applied: Awaited<ReturnType<typeof universalAccess.setPublicAccess>>;
  try {
    applied = await universalAccess.setPublicAccess(
      url,
      // controlRead and controlWrite must be equal or the WAC path throws.
      // Both false: the public never administers anything here.
      { read, append: false, write: false, controlRead: false, controlWrite: false },
      { fetch },
    );
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (applied === null) {
    // Documented as "the current user does not have permission to view or
    // change access", but it is also what a server that stores nothing returns.
    // Either way the access is not known to be what was asked for.
    return err(
      unverified(
        url,
        `public read=${read}`,
        "the server did not report the resulting access (no Control, or an unknown mechanism)",
      ),
    );
  }
  // Control included, as on the container path: a public Control grant is how
  // "public read" becomes "anyone may rewrite the access", and it is exactly
  // the mode a caller forgets to look at.
  if (applied.read !== read || applied.write || applied.append || applied.controlRead || applied.controlWrite) {
    return err(
      unverified(
        url,
        `public read=${read}, and no public write or control`,
        `read=${applied.read} append=${applied.append} write=${applied.write} ` +
          `controlRead=${applied.controlRead} controlWrite=${applied.controlWrite}`,
      ),
    );
  }
  return ok(null);
}

/** Documents go through universalAccess, which phase 0 exercised on both WAC
 *  and ACP unchanged (§19). Publishing an entry is exactly this plus the
 *  dy:status flip — two operations, one transaction (§10). */
async function setDocumentPublicRead(
  url: string,
  fetch: PodFetch,
  read: boolean,
): Promise<Result<AccessState>> {
  const applied = await applyDocumentPublicRead(url, fetch, read);
  if (!applied.ok) return err(applied.error);

  // Cross-check against the server's own evaluation where it offers one, since
  // the above is still only the rules we just wrote, read back.
  let server: ReturnType<typeof serverPublicAccess>;
  try {
    server = serverPublicAccess(await getResourceInfo(url, { fetch }));
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (server && (server.read !== read || server.write || server.append)) {
    return err(
      unverified(
        url,
        `the server to report public read=${read}`,
        `WAC-Allow public read=${server.read} append=${server.append} write=${server.write}`,
      ),
    );
  }

  return ok({
    url,
    read,
    append: false,
    write: false,
    inherits: false,
    inheritsVerifiedBy: "notApplicable",
    verifiedBy: server ? "server" : "rules",
  });
}

/* ---------------------------------------------------------------- the §5 four */

/**
 * Make a resource publicly readable. On a CONTAINER that means read that
 * reaches the children without leaving the container enumerable (§20).
 * ./notes.md#makeprivate-on-a-container-cannot-go-through-universalaccess
 */
export function makePublic(url: string, opts: AccessOptions): Promise<Result<AccessState>> {
  return isContainerUrl(url)
    ? setContainerAccess(url, opts, true)
    : setDocumentPublicRead(url, opts.fetch, true);
}

/** Take a resource out of public reach. The owner keeps it; this is the ACL
 *  half of unpublishing (§5: "flip dy:status, and relax that resource's ACL"). */
export function makePrivate(url: string, opts: AccessOptions): Promise<Result<AccessState>> {
  return isContainerUrl(url)
    ? setContainerAccess(url, opts, false)
    : setDocumentPublicRead(url, opts.fetch, false);
}

/**
 * What a logged-out reader actually gets. Prefers the server's own evaluation
 * over our reading of the rules, and returns an ERROR rather than `read: false`
 * when neither can be established.
 * ./notes.md#getaccess-prefers-the-servers-evaluation-and-errors-rather-than-saying-false
 */
export async function getAccess(url: string, opts: AccessOptions): Promise<Result<PublicAccess>> {
  let server: ReturnType<typeof serverPublicAccess>;
  try {
    server = serverPublicAccess(await getResourceInfo(url, { fetch: opts.fetch }));
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (server) {
    return ok({ url, read: server.read, append: server.append, write: server.write, verifiedBy: "server" });
  }

  // No WAC-Allow. Fall back to the stored rules — weaker evidence, and said so
  // in `verifiedBy` rather than passed off as the same thing.
  let rules: Awaited<ReturnType<typeof universalAccess.getPublicAccess>>;
  try {
    rules = await universalAccess.getPublicAccess(url, { fetch: opts.fetch });
  } catch (cause) {
    return err(toPodError(url, cause));
  }
  if (rules === null) {
    return err(
      unverified(
        url,
        "either a WAC-Allow header or readable authorisations",
        "neither; access here cannot be determined",
      ),
    );
  }
  return ok({ url, read: rules.read, append: rules.append, write: rules.write, verifiedBy: "rules" });
}

/**
 * First-run setup: the §4 containers, with the access §5 intends. Idempotent
 * and safe to re-run. It creates NO CONTENT — writes carry the `dy:` namespace,
 * which is still example.org — and `privacy.ttl` least of all.
 * ./notes.md#initialisecontainers-creates-no-content-and-privacyttl-least-of-all
 */
export async function initialiseContainers(opts: {
  fetch: PodFetch;
  podRoot: string;
  webId: string;
}): Promise<Result<InitReport>> {
  // A pod root without its trailing slash resolves `travel/` against the parent
  // and silently initialises the wrong place.
  const root = opts.podRoot.endsWith("/") ? opts.podRoot : `${opts.podRoot}/`;
  const containers: AccessState[] = [];

  // Parent first: each container gets its OWN ACL, because a container that
  // merely inherits its parent's public default is itself publicly readable —
  // i.e. enumerable. Verified against CSS 7.2.0: with an ACL on travel/ alone,
  // an anonymous GET of travel/trips/ returned 200 and listed its children.
  // createContainer is what makes that one operation rather than two.
  for (const { segment, publicChildren } of CONTAINERS) {
    const url = new URL(segment, root).toString();
    const access = await createContainer(url, {
      fetch: opts.fetch,
      webId: opts.webId,
      publicChildren,
    });
    if (!access.ok) return err(access.error);
    containers.push(access.value);
  }

  return ok({ podRoot: root, containers });
}
