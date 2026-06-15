import { describe, expect, it } from "vitest";
import { normalizeJuniper } from "./juniper";

describe("normalizeJuniper", () => {
  it("parses an rpd (routing) event", () => {
    const line = "rpd[1234]: bgp_event: peer 10.0.0.1 (Internal AS 64512) old state Established event RecvNotify";
    const result = normalizeJuniper(line);
    expect(result).toMatchObject({
      category: "Network",
      normalizedType: "routing_event",
      action: "routing",
    });
  });

  it("parses an mgd (management) config change", () => {
    const line = "mgd[5678]: UI_COMMIT: user 'admin' performed commit";
    const result = normalizeJuniper(line);
    expect(result).toMatchObject({
      category: "System",
      normalizedType: "config_changed",
      action: "configure",
      outcome: "success",
      username: "admin",
    });
  });

  it("parses dcd interface up/down", () => {
    const line = "dcd[1111]: Interface ge-0/0/1, changed state to up";
    const result = normalizeJuniper(line);
    expect(result).toMatchObject({
      category: "Network",
      normalizedType: "interface_up",
      action: "link",
      outcome: "up",
      interfaceName: "ge-0/0/1",
    });
  });

  it("returns empty event for unrecognized program", () => {
    const result = normalizeJuniper("someother[1234]: random log content here");
    expect(result.category).toBeNull();
    expect(result.normalizedType).toBeNull();
  });

  it("handles empty string", () => {
    const result = normalizeJuniper("");
    expect(result.category).toBeNull();
  });
});
