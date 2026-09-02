/**
 * Authenticated Pod writes. STUDIO ONLY — never imported by app/(public).
 *
 * Writes go browser → Pod directly. There is no server-side session, no service
 * account, and no route handler that proxies a write; a full compromise of the
 * hosting still cannot write a single entry.
 *
 * Every write carries a precondition: `If-None-Match: *` to create, `If-Match:
 * <etag>` to update. A blind PUT is a bug — phase 0 confirmed both servers
 * honour these, including rejecting a stale ETag with 412.
 */
export {};
