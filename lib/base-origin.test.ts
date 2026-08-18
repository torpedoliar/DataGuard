import { describe, expect, it } from "vitest";
import { secureOrigin } from "./base-origin";

describe("secureOrigin", () => {
  it("adds https for an external domain and http for localhost", () => {
    expect(secureOrigin("dc.example.com:3000")).toBe("https://dc.example.com:3000");
    expect(secureOrigin("localhost:3000")).toBe("http://localhost:3000");
  });

  it("defaults plain-IP LAN hosts to http (docker-compose on :3001 has no TLS)", () => {
    expect(secureOrigin("192.168.1.10:3000")).toBe("http://192.168.1.10:3000");
    expect(secureOrigin("[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("leaves a full URL untouched", () => {
    expect(secureOrigin("https://dc.example.com")).toBe("https://dc.example.com");
    expect(secureOrigin("http://192.168.1.10:3001")).toBe("http://192.168.1.10:3001");
  });
});