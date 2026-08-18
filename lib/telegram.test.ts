import { describe, expect, it } from "vitest";
import { renderTelegramTemplate } from "./telegram";

describe("renderTelegramTemplate", () => {
  it("renders device asset code placeholders", () => {
    const message = renderTelegramTemplate("Asset: {deviceAssetCode}", {
      deviceAssetCode: "AST-CORE-001",
    });

    expect(message).toBe("Asset: AST-CORE-001");
  });

  it("escapes Markdown characters in ordinary fields", () => {
    const message = renderTelegramTemplate("Device: {deviceName}", {
      deviceName: "switch_[core]*v2`",
    });

    expect(message).toBe("Device: switch\\_\\[core]\\*v2\\`");
  });

  it("keeps a generated incident link clickable when explicitly trusted", () => {
    const link = "[Open incident #42](https://example.test/admin/incidents/42)";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link }, {
      trustedMarkdownFields: ["incidentLink"],
    });

    expect(message).toBe(`Open: ${link}`);
  });

  it("escapes an incident link unless the call site explicitly trusts it", () => {
    const link = "[Open incident #42](https://example.test/admin/incidents/42)";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link });

    expect(message).toBe("Open: \\[Open incident #42](https://example.test/admin/incidents/42)");
  });
});
