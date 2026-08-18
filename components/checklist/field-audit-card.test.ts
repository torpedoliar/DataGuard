import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FieldAuditCard from "./field-audit-card";

describe("FieldAuditCard", () => {
  it("keeps checklist form field names compatible with submitChecklist", () => {
    const html = renderToStaticMarkup(
      React.createElement(FieldAuditCard, {
        device: {
          id: 42,
          name: "UPS A1",
          locationName: "Room 1",
        },
      }),
    );

    expect(html).toContain('name="status-42"');
    expect(html).toContain('name="remarks-42"');
    // deviceId must NOT be emitted by the card: ChecklistForm renders it once
    // per device in its hidden all-devices block, so a card-level duplicate
    // makes formData.getAll("deviceId") return each device twice → double entries.
    expect(html).not.toContain('name="deviceId"');
  });
});
