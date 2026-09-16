import { describe, expect, it } from "vitest";
import { XSD } from "@/lib/vocab";
import { date, dt } from "./literals";

/**
 * §6: explicit datatypes. `dt` already types xsd:dateTime (§7.3's occurredAt);
 * `date`, added alongside it for the trip extent (§7.2), must type xsd:date
 * instead — a different term entirely, not xsd:dateTime with the time cut off.
 */
describe("literals", () => {
  it("dt() types the literal as xsd:dateTime", () => {
    const lit = dt("2026-03-29T21:40:00+09:00");
    expect(lit.value).toBe("2026-03-29T21:40:00+09:00");
    expect(lit.datatype.value).toBe(XSD.dateTime);
  });

  it("date() types the literal as xsd:date, not dateTime", () => {
    const lit = date("2026-03-29");
    expect(lit.value).toBe("2026-03-29");
    expect(lit.datatype.value).toBe(XSD.date);
  });
});
