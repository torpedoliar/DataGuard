import { describe, expect, it } from "vitest";
import { renderTelegramTemplate } from "./telegram";

describe("renderTelegramTemplate", () => {
  it("renders device asset code placeholders", () => {
    const message = renderTelegramTemplate("Asset: {deviceAssetCode}", {
      deviceAssetCode: "AST-CORE-001",
    });

    expect(message).toBe("Asset: AST-CORE-001");
  });
});
