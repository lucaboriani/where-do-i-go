/**
 * First-run Pod setup (§4/§5): the four containers, then a `dy:Diary` root
 * if absent. Idempotent — a 412 on an existing resource is success, not a
 * failure. Authors NO `privacy.ttl`, a ruling rather than the brief:
 * ./notes.md#ensurepodinitialised-authors-no-privacyttl-a-ruling-not-the-brief
 */
import { DataFactory, Writer } from "n3";
import { DCTERMS, DY, DY_CLASS, NS, RDF, SCHEMA_VERSION } from "@/lib/vocab";
import { initialiseContainers } from "./access";
import { dt, int, text } from "./literals";
import { diaryUrl } from "./read";
import type { PodFetch } from "./rdf";
import { err, ok, type Result } from "./result";
import { putGuarded } from "./write";

const { namedNode, quad } = DataFactory;

export type EnsurePodInitialisedOptions = {
  fetch: PodFetch;
  podRoot: string;
  webId: string;
  now?: () => string;
};

/** xsd:dateTime always carries a UTC offset (§6), mirroring save-entry.ts. */
const nowIso = () => new Date().toISOString().replace("Z", "+00:00");

/**
 * §7.1's `<#it>` — a title stamped once so the resource is valid immediately;
 * the owner renames it through the studio afterward (Stage 2). Pure, like
 * every other serialiser in this project.
 */
function serialiseDiary(url: string, webId: string, modified: string): Promise<string> {
  const it = namedNode(`${url}#it`);
  const quads = [
    quad(it, namedNode(RDF.type), namedNode(DY_CLASS.Diary)),
    quad(it, namedNode(DCTERMS.title), text({ value: "My travels", language: "en" })),
    quad(it, namedNode(DCTERMS.creator), namedNode(webId)),
    quad(it, namedNode(DCTERMS.modified), dt(modified)),
    quad(it, namedNode(DY.schemaVersion), int(SCHEMA_VERSION)),
  ];
  const writer = new Writer({ prefixes: { xsd: NS.xsd, dcterms: NS.dcterms, dy: NS.dy } });
  writer.addQuads(quads);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/**
 * Create-if-absent: `If-None-Match: *`, and a 412 against a resource already
 * there is success, not a failure — first run must be safe to re-run.
 */
async function createIfAbsent(fetch: PodFetch, url: string, body: string): Promise<Result<void>> {
  const written = await putGuarded(fetch, url, body, { create: true });
  if (written.ok) return ok(undefined);
  if (written.error.kind === "http" && written.error.status === 412) return ok(undefined);
  return err(written.error);
}

/**
 * The whole first-run flow: the §4 containers, then `diary.ttl` if absent.
 * Containers first, since the diary write depends on nothing they don't also
 * guard, and a container failure should stop everything after it.
 */
export async function ensurePodInitialised(
  opts: EnsurePodInitialisedOptions,
): Promise<Result<void>> {
  const containers = await initialiseContainers({
    fetch: opts.fetch,
    podRoot: opts.podRoot,
    webId: opts.webId,
  });
  if (!containers.ok) return err(containers.error);

  const stamp = (opts.now ?? nowIso)();
  const url = diaryUrl(containers.value.podRoot);
  const body = await serialiseDiary(url, opts.webId, stamp);
  return createIfAbsent(opts.fetch, url, body);
}
