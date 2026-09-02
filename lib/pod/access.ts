/**
 * The ONLY module in this codebase that touches access control.
 *
 * Four methods, per docs/data-model.md §5: makePublic, makePrivate, getAccess,
 * initialiseContainers. Enforced by no-restricted-imports, which bans ACL
 * primitives everywhere else.
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
 */
export {};
