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

  it("parses Allied Telesis awplus syslog with leading year", () => {
    const parsed = parseSyslogMessage("<13> 2026 May 26 09:57:16 awplus IMISH[10424]: [SCRIPT]copy run start");
    expect(parsed).toMatchObject({
      parser: "rfc3164",
      priority: 13,
      facility: 1,
      severity: 5,
      hostname: "awplus",
      program: "IMISH",
      processId: "10424",
      message: "[SCRIPT]copy run start",
    });
    expect(parsed.eventTime?.getUTCFullYear()).toBe(2026);
    expect(parsed.eventTime?.getUTCMonth()).toBe(4);
    expect(parsed.eventTime?.getUTCDate()).toBe(26);
  });

  it("parses Allied Telesis awplus syslog without process id", () => {
    expect(parseSyslogMessage("<14>2026 May 26 09:57:16 awplus IMISH: [SCRIPT]enable")).toMatchObject({
      parser: "rfc3164",
      priority: 14,
      hostname: "awplus",
      program: "IMISH",
      processId: null,
      message: "[SCRIPT]enable",
    });
  });

  it("parses awplus kernel notice with martian destination", () => {
    expect(parseSyslogMessage("<4> 2026 May 29 14:54:05 awplus kernel: IPv4: martian destination 0.0.0.0 from 10.10.191.182, dev vlan18\n")).toMatchObject({
      parser: "rfc3164",
      priority: 4,
      hostname: "awplus",
      program: "kernel",
      message: "IPv4: martian destination 0.0.0.0 from 10.10.191.182, dev vlan18",
    });
  });

  it("parses short PoE syslog without hostname or program", () => {
    expect(parseSyslogMessage("<134>May 29 16:09:22 PoE Port 8 power off!")).toMatchObject({
      parser: "rfc3164",
      priority: 134,
      facility: 16,
      severity: 6,
      hostname: null,
      program: null,
      message: "PoE Port 8 power off!",
    });
  });

  it("strips trailing CR or LF when matching RFC3164", () => {
    expect(parseSyslogMessage("<189>May 22 10:15:30 router01 login: failed password\r\n")).toMatchObject({
      parser: "rfc3164",
      priority: 189,
      hostname: "router01",
      program: "login",
      message: "failed password",
    });
  });
});
