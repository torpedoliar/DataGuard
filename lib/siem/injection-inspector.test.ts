import { describe, expect, it } from "vitest";
import { hasHighRiskInjectionIndicator, inspectRawLogInjection } from "./injection-inspector";

describe("inspectRawLogInjection", () => {
  it("flags script tags without executing or transforming output", () => {
    const indicators = inspectRawLogInjection('<script>alert("x")</script> login failed');

    expect(indicators).toMatchObject([{ key: "script_tag", severity: "high" }]);
    expect(hasHighRiskInjectionIndicator('<script>alert("x")</script>')).toBe(true);
  });

  it("flags encoded html markers and decoded script tags", () => {
    const indicators = inspectRawLogInjection("&lt;script&gt;alert(1)&lt;/script&gt;");

    expect(indicators.map((indicator) => indicator.key)).toEqual(expect.arrayContaining(["html_entity", "script_tag"]));
  });

  it("flags event handlers and javascript urls", () => {
    const indicators = inspectRawLogInjection('<img src=x onerror=alert(1)> href="javascript:alert(1)"');

    expect(indicators.map((indicator) => indicator.key)).toEqual(expect.arrayContaining(["event_handler", "javascript_url"]));
  });

  it("does not flag normal syslog text", () => {
    expect(inspectRawLogInjection("%LINK-3-UPDOWN: Interface GigabitEthernet1/0/1 changed state to down")).toEqual([]);
  });
});
