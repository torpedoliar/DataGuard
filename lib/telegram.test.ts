import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeTelegramHtml, renderTelegramTemplate, sendTelegramAlert } from "./telegram";

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

  it("HTML-escapes entity characters in ordinary fields (#58)", () => {
    const message = renderTelegramTemplate("Device: {deviceName}", {
      deviceName: "switch_<a>&\"'v2",
    });

    expect(message).toBe("Device: switch_&lt;a&gt;&amp;&quot;&#39;v2");
  });

  it("converts a trusted generated incident link into an HTML anchor", () => {
    const link = "[Open incident #42](https://example.test/admin/incidents/42)";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link }, {
      trustedMarkdownFields: ["incidentLink"],
    });

    expect(message).toBe('Open: <a href="https://example.test/admin/incidents/42">Open incident #42</a>');
  });

  it("escapes an untrusted link as plain text instead of rendering an anchor", () => {
    const link = "[Open incident #42](https://example.test/admin/incidents/42)";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link });

    expect(message).toBe("Open: [Open incident #42](https://example.test/admin/incidents/42)");
  });

  it("refuses to build an anchor from a non-http(s) trusted link", () => {
    const link = "[Open incident #42](javascript:alert(1))";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link }, {
      trustedMarkdownFields: ["incidentLink"],
    });

    expect(message).toBe("Open: [Open incident #42](javascript:alert(1))");
  });

  it("escapes the scheme when a trusted link label/url carries HTML", () => {
    const link = "[<b>& evil](https://example.test/a?b=1&c=2)";
    const message = renderTelegramTemplate("Open: {incidentLink}", { incidentLink: link }, {
      trustedMarkdownFields: ["incidentLink"],
    });

    expect(message).toBe('Open: <a href="https://example.test/a?b=1&amp;c=2">&lt;b&gt;&amp; evil</a>');
  });

  it("escapeTelegramHtml covers every entity Telegram parses", () => {
    expect(escapeTelegramHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
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
    const body = JSON.parse(String(init?.body));
    // #58: legacy Markdown parse_mode was replaced by HTML.
    expect(body.parse_mode).toBe("HTML");
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