import { describe, expect, it } from "vitest";
import { users } from "./schema";

describe("PIC owner storage", () => {
  it("uses JSONB and serializes owner IDs as JSON arrays", () => {
    const column = users.responsibleForGroups;

    expect(column.getSQLType()).toBe("jsonb");
    expect(column.mapToDriverValue(["42", "99"])).toBe('["42","99"]');
    expect(column.mapToDriverValue([])).toBe("[]");
    expect(column.mapFromDriverValue('["42","99"]')).toEqual(["42", "99"]);
  });
});
