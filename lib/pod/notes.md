# lib/pod — notes

Prose that outgrew a docblock, and findings recorded rather than acted on.
Section numbers are `docs/data-model.md`; decision numbers are
`docs/decisions.md`. Both stay the normative sources.

## An unreadable ACL looks exactly like no ACL

`resolveContainerAcl`'s three answers come from `hasResourceAcl` and
`hasFallbackAcl`, and the first of those cannot distinguish "this container has
no ACL of its own" from "its ACL could not be fetched just now".
`internal_fetchResourceAcl` in `@inrupt/solid-client` 3.0.0
(`dist/acl/acl.internal.mjs`) catches everything that is not an `AclIsAcrError`
and returns `null`, with its own comment giving the reason: a Solid server sends
a `rel="acl"` link whether or not the document behind it exists, so a failed
fetch is the ordinary case. A 403 or a 500 on `{container}.acl` therefore
arrives here as `resourceAcl: null` — indistinguishable from absence.

**What that costs is a diagnosis, not a write.** The branch that follows takes
the ancestor's rules and a `create: true` precondition, so the PUT goes out as
`If-None-Match: *` and the server answers 412 against the ACL that is really
there. Nothing is overwritten: §10's precondition is doing exactly the job it
exists for, and this is a good illustration of why a blind PUT is banned even
where the code "knows" the resource is absent. But the report a deployer reads
is `http 412` about the container, which describes a race rather than the
transient failure that actually happened, and a retry may well succeed.

Left alone deliberately, on 2026-09-08, during a refactor whose rule is that
behaviour does not change. Fixing it means distinguishing the two cases before
choosing a precondition — a HEAD of the control document, or catching the 412
and re-reading — and either is a behaviour change with its own test.

## Why the container path is not a mechanism branch

Recorded here because the split of `setContainerAccess` into three steps invites
the question a fourth time. Decision 19 is settled: **access control goes
through one interface and never branches on mechanism.** The steps divide the
write sequence — which ACL to edit and under which precondition, what the rules
are, and the PUT — and the only branch in the module is on the resource kind,
document versus container, which is a property of LDP rather than of a server.

The trap that makes it a decision rather than a preference: ESS advertises
`Link: <https://authorization.inrupt.com/{id}>; rel="acl"`, a separate
authorization host and not a sibling `.acl`, and that resource carries both
`acp#` and `auth/acl#` vocabulary because ACP reuses `acl:` mode IRIs. Sniffing
the link relation reports "WAC" for an ACP server. `hasAccessibleAcl` is that
sniff — it is `typeof aclUrl === "string"` — which is why it appears in
`resolveContainerAcl` only as the type guard the library needs for `aclUrl` to
be a string, and never as evidence on its own.
