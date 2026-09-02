#!/usr/bin/env python3
"""Validate the Turtle fixtures embedded in data-model.md.

Checks, for every ```turtle block in the document:
  - it parses standalone (all prefixes declared)
  - relative IRIs resolve to the intended absolute URLs
  - no blank nodes anywhere
  - coordinates are xsd:decimal, never xsd:float
  - every xsd:dateTime literal carries a UTC offset

Run in CI. Requires: pip install rdflib
"""
import re
import sys
from pathlib import Path

from rdflib import Graph, BNode, Literal
from rdflib.namespace import XSD

REPO_ROOT = Path(__file__).resolve().parent.parent
DOC = REPO_ROOT / "docs" / "data-model.md"
POD = "https://me.solidcommunity.net"

# Base URI each turtle block would be served from, in document order.
CASES = [
    ("diary",     f"{POD}/travel/diary.ttl"),
    ("trip",      f"{POD}/travel/trips/2026-japan/trip.ttl"),
    ("entry",     f"{POD}/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl"),
    ("index",     f"{POD}/travel/trips/2026-japan/entries.ttl"),
    ("profile",   f"{POD}/profile/card"),
    ("typeindex", f"{POD}/settings/publicTypeIndex.ttl"),
]

GEO_PREDS = ("latitude", "longitude", "#lat", "#long", "bbox", "center")
DT_RE = re.compile(r"[+-]\d{2}:\d{2}$|Z$")

failures = []


def fail(label, msg):
    failures.append(f"[{label}] {msg}")


def main():
    doc = DOC.read_text(encoding="utf-8")
    blocks = re.findall(r"```turtle\n(.*?)```", doc, re.S)

    if len(blocks) != len(CASES):
        print(f"FAIL: found {len(blocks)} turtle blocks, expected {len(CASES)}.")
        print("Update CASES if the document gained or lost an example.")
        return 1

    for block, (label, base) in zip(blocks, CASES):
        g = Graph()
        try:
            g.parse(data=block, format="turtle", publicID=base)
        except Exception as exc:
            fail(label, f"does not parse standalone: {exc}")
            continue

        for triple in g:
            if any(isinstance(term, BNode) for term in triple):
                fail(label, f"blank node in {triple}")

        for s, p, o in g:
            if not isinstance(o, Literal):
                continue
            if o.datatype == XSD.float:
                fail(label, f"xsd:float literal on {p} (use xsd:decimal)")
            if any(k in str(p) for k in GEO_PREDS) and o.datatype != XSD.decimal:
                fail(label, f"{p} is {o.datatype}, expected xsd:decimal")
            if o.datatype == XSD.dateTime and not DT_RE.search(str(o)):
                fail(label, f"dateTime without UTC offset on {p}: {o}")

        # No IRI should still look relative after resolution.
        for s, p, o in g:
            for term in (s, o):
                t = str(term)
                if t.startswith(("../", "./")) or ".." in t.split("://")[-1]:
                    fail(label, f"unresolved relative IRI: {t}")

        print(f"[{label}] ok — {len(g)} triples")

    if failures:
        print("\n" + "\n".join(failures))
        print(f"\n{len(failures)} problem(s).")
        return 1

    print("\nAll fixtures valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
