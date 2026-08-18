import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the settings read and request headers so resolveNotificationBaseUrl runs
// without Postgres or a request scope.
const settingsRead = vi.fn().mockResolvedValue([]);
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.limit = (..._args: unknown[]) => Promise.resolve(settingsRead(..._args));
      return chain;
    },
  },
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

import { resolveNotificationBaseUrl } from "./notification-url";

function stored(value: string | null) {
  return value === null ? [] : [{ notificationBaseUrl: value }];
}

beforeEach(() => {
  vi.stubEnv("APP_URL", "");
  settingsRead.mockResolvedValue([]);
  headersMock.mockReset();
  headersMock.mockRejectedValue(new Error("outside request scope"));
});

describe("resolveNotificationBaseUrl priority", () => {
  it("prefers the operator-controlled APP_URL over the stored login host", async () => {
    vi.stubEnv("APP_URL", "https://alerts.example.com");
    settingsRead.mockResolvedValue(stored("192.168.1.10:3001"));
    expect(await resolveNotificationBaseUrl()).toBe("https://alerts.example.com");
  });

  it("uses the stored login host when APP_URL is not set", async () => {
    settingsRead.mockResolvedValue(stored("dc.example.com:3001"));
    expect(await resolveNotificationBaseUrl()).toBe("https://dc.example.com:3001");
  });

  it("renders a stored plain-IP login host as http (LAN deployment)", async () => {
    settingsRead.mockResolvedValue(stored("192.168.1.10:3001"));
    expect(await resolveNotificationBaseUrl()).toBe("http://192.168.1.10:3001");
  });

  it("falls back to the request host when nothing is stored", async () => {
    headersMock.mockResolvedValue({
      get: (name: string) => (name === "host" ? "dc.example.com" : null),
    });
    expect(await resolveNotificationBaseUrl()).toBe("https://dc.example.com");
  });

  it("defaults to localhost when every source is unavailable", async () => {
    expect(await resolveNotificationBaseUrl()).toBe("http://localhost:3000");
  });
});