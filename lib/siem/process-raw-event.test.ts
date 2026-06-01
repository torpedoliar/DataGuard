import { describe, expect, it } from "vitest";
import { processRawSyslogEvent } from "./process-raw-event";

describe("processRawSyslogEvent", () => {
  it("parses and normalizes a generic event", () => {
    expect(processRawSyslogEvent({ rawMessage: "<34>May 22 10:15:30 host sshd: Failed password for admin from 10.0.0.2", vendor: "generic" })).toMatchObject({
      parser: "rfc3164",
      normalizedType: "auth_failed",
      username: "admin",
      srcIp: "10.0.0.2",
      ingestStatus: "parsed",
    });
  });

  it("keeps malformed raw data as parse_failed", () => {
    expect(processRawSyslogEvent({ rawMessage: "bad", vendor: "generic" })).toMatchObject({ parser: "fallback", message: "bad", ingestStatus: "parse_failed" });
  });
});
