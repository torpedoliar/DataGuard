import { describe, expect, it } from "vitest";
import { assertWatchGuardRequest, classifyOutbound, READ_ONLY_BLOCKED } from "./guard";
import { WatchGuardError } from "./errors";

const HOST = "api.jpn.cloud.watchguard.com";
const ACCOUNT = "WGC-3-123456";

const TOKEN_FORM = "grant_type=client_credentials&scope=api-access";

function url(path: string, host: string = HOST): string {
  return `https://${host}${path}`;
}

describe("classifyOutbound — read GETs", () => {
  const allowedGets: [string, string][] = [
    ["account", `/rest/platform/accounts/v2/accounts/${ACCOUNT}`],
    ["devices", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`],
    ["protection status", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devicesprotectionstatus`],
    ["unmanaged devices", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/unmanageddevices`],
    ["licenses", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/licenses`],
    ["event counters", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/securityeventcounters/1`],
    ["security events export", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/securityevents/1/export/7`],
    ["security overview", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/securityoverview/7`],
    ["managed configurations", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/managedconfigurations/2`],
    ["tasks", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/tasks`],
    ["task details", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/taskdetails/1/task-0001`],
    ["task jobs", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/tasks/1/task-0001/jobs`],
    ["task job status", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/tasks/1/task-0001/jobs/job-0001/status`],
    ["task job results", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/tasks/1/task-0001/jobs/job-0001/results`],
    ["threatsync incidents", `/rest/threatsync/management/v1/${ACCOUNT}/incidents`],
    ["threatsync incident", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-incident-0001`],
    ["threatsync incident comments", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-incident-0001/comments`],
    ["threatsync incident actions", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-incident-0001/actions`],
    ["threatsync incident action", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-incident-0001/actions/action-0001`],
    ["threatsync actions", `/rest/threatsync/management/v1/${ACCOUNT}/actions`],
    ["threatsync action", `/rest/threatsync/management/v1/${ACCOUNT}/actions/action-0001`],
  ];

  it.each(allowedGets)("allows GET %s", (_label, path) => {
    const result = classifyOutbound("GET", url(path));
    expect(result.allowed).toBe(true);
  });

  it("allows GET with a query string (paging params)", () => {
    const result = classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices?$top=1000&$skip=0&$count=true`));
    expect(result.allowed).toBe(true);
  });
});

describe("classifyOutbound — token POST", () => {
  it("allows the exact OAuth token POST", () => {
    const result = classifyOutbound("POST", url("/oauth/token"), TOKEN_FORM);
    expect(result.allowed).toBe(true);
  });

  it("rejects a token POST with altered grant or scope", () => {
    expect(classifyOutbound("POST", url("/oauth/token"), "grant_type=password&scope=api-access").allowed).toBe(false);
    expect(classifyOutbound("POST", url("/oauth/token"), "grant_type=client_credentials&scope=other").allowed).toBe(false);
  });

  it("rejects a token POST with extra params", () => {
    expect(classifyOutbound("POST", url("/oauth/token"), `${TOKEN_FORM}&business_payload=1`).allowed).toBe(false);
  });

  it("rejects a token POST with a trailing/alternate path", () => {
    expect(classifyOutbound("POST", url("/oauth/token/"), TOKEN_FORM).allowed).toBe(false);
    expect(classifyOutbound("POST", url("/oauth/token2"), TOKEN_FORM).allowed).toBe(false);
  });
});

describe("classifyOutbound — blocked mutations and known-trick rejections", () => {
  it.each([
    ["immediatescan POST", "POST", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/immediatescan`],
    ["reboot POST", "POST", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices/action`],
    ["isolation POST", "POST", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices/isolation`],
    ["unisolation POST", "POST", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices/noisolation`],
    ["assign config PATCH", "PATCH", `/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/managedconfigurations/2/cfg-x`],
    ["incident status PATCH", "PATCH", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-1`],
    ["incident comment POST", "POST", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-1/comments`],
    ["incident action POST", "POST", `/rest/threatsync/management/v1/${ACCOUNT}/incidents/ts-1/actions`],
  ])("blocks %s", (_label, method, path) => {
    expect(classifyOutbound(method, url(path)).allowed).toBe(false);
  });

  it("rejects unlisted methods even on a read path", () => {
    expect(classifyOutbound("DELETE", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`)).allowed).toBe(false);
    expect(classifyOutbound("PUT", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`)).allowed).toBe(false);
  });

  it("rejects unknown GET paths (fail closed)", () => {
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/admin`)).allowed).toBe(false);
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devicesx`)).allowed).toBe(false);
  });

  it("rejects a non-allowlisted host/region", () => {
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`, "api.evil.example.com")).allowed).toBe(false);
  });

  it("rejects non-HTTPS protocol", () => {
    expect(classifyOutbound("GET", `http://${HOST}/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`).allowed).toBe(false);
  });

  it("rejects a non-standard port", () => {
    expect(classifyOutbound("GET", `https://${HOST}:8443/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`).allowed).toBe(false);
  });

  it("rejects URL userinfo, fragment and path traversal tricks", () => {
    expect(classifyOutbound("GET", `https://user:pass@${HOST}/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`).allowed).toBe(false);
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices#frag`)).allowed).toBe(false);
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/../devices`)).allowed).toBe(false);
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/%2fdevices`)).allowed).toBe(false);
    expect(classifyOutbound("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices\\extra`)).allowed).toBe(false);
  });
});

describe("assertWatchGuardRequest", () => {
  it("throws the typed read-only error for blocked requests", () => {
    expect(() => assertWatchGuardRequest("POST", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/immediatescan`), "{}"))
      .toThrowError(WatchGuardError);
    try {
      assertWatchGuardRequest("POST", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/immediatescan`), "{}");
    } catch (error) {
      const err = error as WatchGuardError;
      expect(err.kind).toBe("read_only_blocked");
      expect(err.message).toContain(READ_ONLY_BLOCKED);
    }
  });

  it("returns the parsed URL for allowed requests", () => {
    const result = assertWatchGuardRequest("GET", url(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`));
    expect(result.url.protocol).toBe("https:");
    expect(result.path).toBe(`/rest/endpoint-security/management/api/v1/accounts/${ACCOUNT}/devices`);
  });
});