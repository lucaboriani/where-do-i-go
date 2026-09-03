/**
 * The ONLY module in this codebase that touches access control.
 *
 * Five exported operations: makePublic, makePrivate, getAccess,
 * createContainer, initialiseContainers. The first four of those are §5's
 * interface; createContainer is there because a container created without an
 * ACL of its own is publicly enumerable (see below). Enforced by
 * no-restricted-imports, which bans the ACL primitives everywhere else.
 *
 * Do not detect the mechanism and branch on it. Phase 0 showed CSS uses WAC and
 * Inrupt ESS uses ACP, but ESS advertises `rel="acl"` pointing at a separate
 * authorization host, and its control resource carries both acp# and acl#
 * vocabulary. Sniffing the link relation reports "WAC" for an ACP server.
 * `universalAccess` from @inrupt/solid-client handled both unchanged
 * (docs/decisions.md §19).
 *
 * initialiseContainers must also, per phase 0:
 *   - set inheritance explicitly; a pod root's public read does not cascade
 *   - close the container listing where the server allows it, or draft slugs
 *     leak via ldp:contains even though draft content is protected
 *   - verify the resulting access rather than assuming the writes took effect
 *
 * ---------------------------------------------------------------------------
 * HOW THAT IS IMPLEMENTED, AND WHERE THE EVIDENCE STOPS
 *
 * There is one branch in this file and it is on the RESOURCE KIND, never on the
 * server. A document and a container need different things said about them —
 * §5: "Containers carry the default; individual draft resources override it" —
 * and that is a property of LDP, true on WAC and ACP alike.
 *
 *   documents  -> universalAccess. Phase 0 granted public read through it on
 *                 both CSS and ESS with identical calling code (§19), so it is
 *                 the mechanism-agnostic path and it is used wherever it can
 *                 express what we mean.
 *
 *   containers -> `acl:default` WITHOUT `acl:accessTo`. universalAccess cannot
 *                 express this: setPublicAccess documents that "if the Resource
 *                 is a Container, the configured Access will not apply to
 *                 contained Resources", so on its own it produces a diary whose
 *                 pages are all 401 — while returning 2xx. The split shape is
 *                 the fix decisions.md §20 records as VERIFIED ON WAC and
 *                 explicitly UNVERIFIED ON ACP ("ACP has no accessTo/default
 *                 split of this shape").
 *
 * THE CONTAINER PATH REFUSES RATHER THAN GUESSES. Writing that shape means
 * writing a WAC ACL document, so it runs only when there is positive evidence
 * that the target IS a WAC ACL: `hasResourceAcl` or `hasFallbackAcl`, both of
 * which mean the library fetched an ACL document and parsed acl: rules out of
 * it. `hasAccessibleAcl` is NOT that evidence and is never used as it — it is
 * literally `typeof aclUrl === "string"`, i.e. "the server sent a rel=acl
 * link", which ESS does while pointing at its ACP authorization host (§19). On
 * ESS the library raises AclIsAcrError internally, reports neither a resource
 * nor a fallback ACL, and this module returns `accessUnverified`. That is a
 * refusal, not a mechanism branch: the same code path, the same question asked
 * of every server, and no server is identified. It does not fall back to a
 * wider grant either — the fallback would silently reopen the container listing
 * that §20 exists to close, and it would be untested code claiming a guarantee
 * nobody has measured.
 *
 * Every method verifies the RESULT rather than the status code. Two kinds of
 * evidence, and they are not equal:
 *
 *   "server" — the WAC-Allow header, i.e. the server's own evaluation of what
 *              an unauthenticated request would get. This is the strong one.
 *   "rules"  — the stored authorisations, read back from the server after the
 *              write. Proves the write persisted as written; does not prove the
 *              server enforces it.
 *
 * Neither is proof of enforcement. The only proof is a read that fails from a
 * logged-out context, which needs a fetch this module deliberately does not
 * have — the caller's fetch is the only fetch, so that a studio session can
 * never be silently downgraded to anonymous. That evidence lives in
 * test/pod-access.integration.test.ts against a real Community Solid Server.
 */
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
   * How `read`/`append`/`write` above were established.
   *
   * "server" — the WAC-Allow header: the server's own evaluation of what an
   *            unauthenticated request would get.
   * "rules"  — the stored authorisations, read back after the write.
   *
   * NEITHER VALUE PROVES ENFORCEMENT. "server" is the server's answer to a
   * question asked over an authenticated connection, and "rules" is only what
   * is stored. The single thing that proves a restriction is a request from the
   * context that should be denied — which this module cannot make, because the
   * caller's fetch is the only fetch it has (invariant 4). Do not render either
   * value as a guarantee to the owner.
   */
  verifiedBy: "server" | "rules";
};

export type AccessState = PublicAccess & {
  /** Containers only: does public read reach the resources inside? This is the
   *  half that makes a diary readable, and the half a 2xx never proves. */
  inherits: boolean;
  /**
   * How `inherits` was established — deliberately NOT the same field as
   * `verifiedBy`, because it can never be as strong.
   *
   * "rules"         — the `acl:default` triple this module wrote, read back. No
   *                   server header answers "what would an anonymous request to
   *                   a CHILD of this container get?", so there is no "server"
   *                   value available here and the type says so. The evidence
   *                   that inheritance actually reaches a child is an anonymous
   *                   GET of that child, in the integration suite.
   * "notApplicable" — a document. It has no children.
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

/** The §4 layout. Media is one global container, outside any trip, so that
 *  publishing never has to move binaries. */
const CONTAINERS = ["travel/", "travel/trips/", "travel/media/"] as const;

/**
 * Report the URL the CALLER asked about, not the URL that happened to fail.
 *
 * A FetchError's `response.url` is empty for a synthesised Response, and an
 * inner failure on `{root}.acl` while initialising `{root}scoped/travel/` names
 * a resource the caller never mentioned. Both make the error unactionable.
 */
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
 * Create a container if it is not already there. Idempotent, because §5 asks
 * for a first-run flow that is "safe to re-run" and this is the flow a deployer
 * retries after any failure.
 *
 * The create still carries `If-None-Match: *`. A 412 then means "someone else
 * got there first", which is the success case here, not a failure — and it is
 * why this is not a blind PUT even though it may run twice.
 *
 * Private on purpose: a container created through this alone has no ACL of its
 * own and is therefore publicly enumerable (see createContainer).
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
 * Create a container AND give it its own access control, as one operation.
 *
 * This exists because the two halves cannot safely be separate. `acl:default`
 * inherits recursively, so a container created below `travel/trips/` with no
 * ACL of its own is covered by the parent's default rule — including as a
 * resource in its own right, which makes its LISTING public. Measured against
 * CSS 7.2.0 on a Pod initialised by this module: an anonymous
 * `GET /travel/trips/2026-japan/` returned 200 with
 * `WAC-Allow: user="read",public="read"` and a body containing
 * `ldp:contains <entries/>, <trip.ttl>`. That is §20's leak one level down —
 * every studio-created trip and entries container, enumerable, with slugs
 * derived from titles.
 *
 * So: no code in this project creates a container any other way. Phase 2's
 * entry- and trip-creation paths call this. The rule is structural rather than
 * remembered, which is the only kind that survives a phase boundary.
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
 * Read a control document as an ACL, keeping the ETag OF THE SAME RESPONSE.
 *
 * The point is the pairing. An ETag taken from a later HEAD says nothing about
 * the body this module is editing: a change landing in between — two studio
 * tabs, makePublic racing makePrivate — would satisfy `If-Match` and be
 * overwritten. One GET, one ETag, one body, and §10's precondition means what
 * it says.
 *
 * `internal_accessTo` is what makes a SolidDataset an AclDataset: the resource
 * these rules govern. It is set to the server's own source IRI for that
 * resource, which is exactly what @inrupt/solid-client does when it fetches an
 * ACL itself (acl.internal.ts, internal_fetchResourceAcl).
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
 * Write the container shape: public read that reaches the children, and a
 * listing that stays shut.
 *
 * `publicInherit: false` is the same shape with the public grant removed, which
 * is what makePrivate on a container has to do — universalAccess would clear
 * the resource rule and leave the `acl:default` rule standing, i.e. report
 * success while every child stayed public. Verified in a spike against CSS
 * 7.2.0: after `setPublicAccess(doc, { read: false })` the resulting ACL still
 * contained `acl:agentClass foaf:Agent; acl:mode acl:Read; acl:default …`.
 */
async function setContainerAccess(
  url: string,
  opts: AccessOptions,
  publicInherit: boolean,
): Promise<Result<AccessState>> {
  const { fetch } = opts;

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
    // fetched and parsed, and its `acl:default` rules are what currently apply.
    // createAclFromFallbackAcl copies those rules onto this resource, which is
    // what keeps the owner's Control when the parent's default stops applying.
    //
    // hasAccessibleAcl appears here ONLY as the type guard the library requires
    // for the aclUrl to be a string. It is not evidence of anything and is not
    // consulted alone: on an ACP server it is true and both clauses above are
    // false, so this branch is unreachable there.
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

  // The owner, if the caller named one. Nothing else is carried over by hand:
  // in the branch above either the ACL already holds every existing rule, or
  // createAclFromFallbackAcl copied them — including the agent-class and group
  // rules an agent-by-agent carry-over would have dropped, and without the
  // widening that comes of turning an accessTo-only rule into a default one.
  if (opts.webId) {
    acl = setAgentResourceAccess(acl, opts.webId, OWNER_FULL);
    acl = setAgentDefaultAccess(acl, opts.webId, OWNER_FULL);
  }

  // The two halves of §20's fix. `default` without `accessTo`: children stay
  // readable, the listing closes, the authenticated studio still enumerates.
  acl = setPublicDefaultAccess(acl, publicInherit ? PUBLIC_READ : PUBLIC_NOTHING);
  acl = setPublicResourceAccess(acl, PUBLIC_NOTHING);

  // Refuse to write an ACL that locks everyone out of it. On WAC an ACL with no
  // Control rule cannot be repaired through the API that wrote it, so this is
  // one of the few unrecoverable mistakes available here. Asked of the document
  // about to be written, not of the server: a network failure or a 403 cannot
  // masquerade as "nobody has Control" the way a swallowed read once did.
  //
  // Control held only by an agent CLASS or a group does not count here — this
  // project's model is one owner plus the public (§5), and a shared Pod needs
  // this thought about rather than assumed. The cost of being wrong is a
  // refusal the caller can fix by passing `webId`, which the two callers that
  // create containers already do.
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

  // The control document is a resource, so §10's write protocol applies to it
  // too: `If-Match: <etag>` to update, `If-None-Match: *` to create. There is
  // no third case, and no degrading to `*`.
  const written = await putGuarded(fetch, aclUrl, body, precondition);
  if (!written.ok) return err(about(url, written.error));

  return verifyContainerAccess(url, fetch, publicInherit);
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
  const acl = getResourceAcl(back);
  const inherited = getPublicDefaultAccess(acl);
  const direct = getPublicResourceAccess(acl);

  if (inherited.read !== publicInherit) {
    return err(
      unverified(
        url,
        `public read ${publicInherit ? "reaching" : "removed from"} the resources inside`,
        `acl:default read=${inherited.read}`,
      ),
    );
  }
  // "Public read, owner-only write" is the defining constraint (§5). Read
  // granted one mode too wide is not a smaller bug.
  if (inherited.write || inherited.append || inherited.control || direct.write || direct.append || direct.control) {
    return err(unverified(url, "no public write anywhere on this container", "a public write grant"));
  }
  if (direct.read) {
    return err(
      unverified(url, "a closed listing (no public acl:accessTo)", "public read on the container itself"),
    );
  }

  // The server's own evaluation, where it offers one. This is the only check
  // here that is not just "what we stored": if the listing is enumerable in
  // spite of the rules, draft slugs are public and the deployer needs to know.
  const server = serverPublicAccess(back);
  if (server && (server.read || server.write || server.append)) {
    return err(
      unverified(
        url,
        "the server to report no public access to the container itself",
        `WAC-Allow public read=${server.read} append=${server.append} write=${server.write}`,
      ),
    );
  }

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

/** Documents go through universalAccess, which phase 0 exercised on both WAC
 *  and ACP unchanged (§19). Publishing an entry is exactly this plus the
 *  dy:status flip — two operations, one transaction (§10). */
async function setDocumentPublicRead(
  url: string,
  fetch: PodFetch,
  read: boolean,
): Promise<Result<AccessState>> {
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
 * Make a resource publicly readable.
 *
 * On a CONTAINER this means "read that reaches the children, without leaving
 * the container enumerable" — anything else publishes every draft slug in it
 * via ldp:contains, and slugs come from titles (decisions.md §20).
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
 * What a logged-out reader actually gets.
 *
 * Prefers the server's own evaluation (WAC-Allow) over our reading of the
 * rules, because the studio's publish indicator is only useful if it answers
 * the second question — what is enforced — rather than the first.
 *
 * Returns an error, never `read: false`, when neither can be established.
 * "Not public" and "could not tell" are different facts and the owner acts on
 * what is shown.
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
 * First-run setup: the §4 containers, with the access §5 intends.
 *
 * Idempotent and safe to re-run, because this is the flow a deployer retries
 * after any failure — a second run reporting "already exists" would make the
 * recovery path indistinguishable from the failure it recovers from.
 *
 * It does NOT create diary.ttl or any other content. Content is a write, and
 * writes carry the dy: namespace, which is still example.org (CLAUDE.md,
 * "Blocked until decided").
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
  for (const segment of CONTAINERS) {
    const url = new URL(segment, root).toString();
    const access = await createContainer(url, { fetch: opts.fetch, webId: opts.webId });
    if (!access.ok) return err(access.error);
    containers.push(access.value);
  }

  return ok({ podRoot: root, containers });
}
