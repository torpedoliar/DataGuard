import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTelegramTemplate, sendTelegramAlert } from "./telegram";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("sendTelegramAlert", () => {
  it("aborts the fetch via a timeout signal so a hung request cannot stall callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTelegramAlert("12345", "hello", "bot-token");

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces the Telegram API description when the API rejects with JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: chat not found",
      }),
    } as Response));

    const result = await sendTelegramAlert("12345", "hello", "bot-token");

    expect(result.success).toBe(false);
    expect(result.message).toBe("Bad Request: chat not found");
  });

  it("falls back to the raw body when the API rejects with a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "<html>502 Bad Gateway</html>",
    } as Response));

    const result = await sendTelegramAlert("12345", "hello", "bot-token");

    expect(result.success).toBe(false);
    expect(result.message).toBe("<html>502 Bad Gateway</html>");
  });

  it("keeps a generic message only as a last resort for an empty error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    } as Response));

    const result = await sendTelegramAlert("12345", "hello", "bot-token");

    expect(result.success).toBe(false);
    expect(result.message).toBe("Gateway rejected request");
  });
});