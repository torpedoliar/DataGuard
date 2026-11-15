import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

const en = flatten(JSON.parse(readFileSync(resolve(process.cwd(), "messages/en.json"), "utf8"))).sort();
const id = flatten(JSON.parse(readFileSync(resolve(process.cwd(), "messages/id.json"), "utf8"))).sort();

describe("locale message parity", () => {
  it("has identical key sets in English and Indonesian", () => {
    expect(id).toEqual(en);
  });
  it("includes the Operations Center namespaces in both locales", () => {
    for (const key of ["Epdr.threatV2.pageSummary", "Epdr.operationsV2.readOnly", "Epdr.localRunV2.finishedNote", "Epdr.notifyV2.scope"]) {
      expect(en).toContain(key);
      expect(id).toContain(key);
    }
  });
});
