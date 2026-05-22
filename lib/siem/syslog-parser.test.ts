import { describe, expect, it } from "vitest";
import { decodePriority, parseSyslogMessage } from "./syslog-parser";

describe("decodePriority", () => {
  it("maps PRI to facility and severity", () => {
    expect(decodePriority(189)).toEqual({ facility: 23, severity: 5 });
    expect(decodePriority(34)).toEqual({ facility: 4, severity: 2 });
  });
});

describe("parseSyslogMessage", () => {
  it("parses RFC3164", () => {
    expect(parseSyslogMessage("<189>May 22 10:15:30 router01 login: failed password for admin from 10.10.1.20")).toMatchObject({
      parser: "rfc3164",
      priority: 189,
      facility: 23,
      severity: 5,
      hostname: "router01",
      program: "login",
      message: "failed password for admin from 10.10.1.20",
    });
  });

  it("parses RFC5424", () => {
    expect(parseSyslogMessage("<34>1 2026-05-22T10:15:30Z host app 123 ID47 - message")).toMatchObject({
      parser: "rfc5424",
      priority: 34,
      facility: 4,
      severity: 2,
      hostname: "host",
      appName: "app",
      processId: "123",
      messageId: "ID47",
      message: "message",
    });
  });

  it("falls back without losing raw message", () => {
    expect(parseSyslogMessage("not syslog")).toMatchObject({ parser: "fallback", message: "not syslog", parseError: "Unsupported syslog format" });
  });
});
