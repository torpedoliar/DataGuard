import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  createServer: vi.fn(),
  Client: vi.fn(),
  drizzle: vi.fn(),
  migrate: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("node:net", () => ({ createServer: mocks.createServer }));
vi.mock("pg", () => ({ Client: mocks.Client }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: mocks.migrate }));

import { startIsolatedPostgres } from "./isolated-postgres";

function probeClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

const port = 15432;
let clients: ReturnType<typeof probeClient>[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  clients = [];
  mocks.execFileSync.mockReturnValue("mock-container\n");
  mocks.createServer.mockImplementation(() => ({
    once: vi.fn(),
    listen: vi.fn((_port: number, _host: string, callback: () => void) => callback()),
    address: vi.fn(() => ({ port })),
    close: vi.fn((callback: () => void) => callback()),
  }));
  mocks.Client.mockImplementation(function () {
    const client = probeClient();
    clients.push(client);
    return client;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function dockerCommands() {
  return mocks.execFileSync.mock.calls.map(([command, args]) => {
    expect(command).toBe("docker");
    return args as string[];
  });
}

describe("startIsolatedPostgres readiness", () => {
  it("requires TCP pg_isready before probing the published port", async () => {
    mocks.execFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "exec") {
        expect(args.slice(2)).toEqual(["pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
        throw new Error("TCP server is not ready");
      }
      return "mock-container";
    });
    const starting = startIsolatedPostgres("test-ready");
    const rejection = expect(starting).rejects.toThrow("isolated PostgreSQL did not become ready");

    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;

    expect(dockerCommands().filter((args) => args[0] === "exec")).toHaveLength(80);
    expect(mocks.Client).not.toHaveBeenCalled();
    expect(dockerCommands().at(-1)).toEqual(["rm", "-f", expect.stringMatching(/^test-ready-/)]);
  });

  it("waits for two successful SELECT 1 probes on fresh published-port clients", async () => {
    const settled = vi.fn();
    const starting = startIsolatedPostgres("test-ready");
    void starting.then(settled);
    await vi.advanceTimersByTimeAsync(0);

    expect(clients).toHaveLength(1);
    expect(clients[0].query).toHaveBeenCalledWith("SELECT 1");
    expect(clients[0].end).toHaveBeenCalledOnce();
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const instance = await starting;

    expect(clients).toHaveLength(2);
    for (const client of clients) {
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.query).toHaveBeenCalledExactlyOnceWith("SELECT 1");
      expect(client.end).toHaveBeenCalledOnce();
    }
    for (const [config] of mocks.Client.mock.calls) {
      expect(config).toEqual({
        host: "127.0.0.1", port, user: "postgres", password: instance.password, database: "postgres", connectionTimeoutMillis: 5_000,
      });
    }
    const commands = dockerCommands();
    expect(commands[0]).toContain(`127.0.0.1:${port}:5432`);
    expect(commands.filter((args) => args[0] === "exec")).toEqual([
      ["exec", instance.container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
      ["exec", instance.container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
    ]);
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(commands.some((args) => args[0] === "rm")).toBe(false);
    instance.cleanup();
    instance.cleanup();
    expect(dockerCommands().filter((args) => args[0] === "rm")).toEqual([["rm", "-f", instance.container]]);
  });

  it.each(["connect", "query"] as const)("retries ECONNRESET during %s, ends the failed client, and resets consecutive successes", async (stage) => {
    mocks.Client.mockImplementation(function () {
      const client = probeClient();
      if (clients.length === 1) {
        client[stage].mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
      }
      clients.push(client);
      return client;
    });
    const settled = vi.fn();
    const starting = startIsolatedPostgres("test-retry");
    void starting.then(settled);
    await vi.advanceTimersByTimeAsync(500);

    expect(clients).toHaveLength(2);
    expect(clients[1].end).toHaveBeenCalledOnce();
    expect(clients[1].query).toHaveBeenCalledTimes(stage === "connect" ? 0 : 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(749);
    expect(clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(clients).toHaveLength(3);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    const instance = await starting;

    expect(clients).toHaveLength(4);
    for (const client of clients) expect(client.end).toHaveBeenCalledOnce();
    for (const client of [clients[0], clients[2], clients[3]]) {
      expect(client.query).toHaveBeenCalledExactlyOnceWith("SELECT 1");
    }
    expect(dockerCommands().some((args) => args[0] === "rm")).toBe(false);
    instance.cleanup();
  });

  it("ends failed probes and removes the container when published-port readiness times out", async () => {
    mocks.Client.mockImplementation(function () {
      const client = probeClient();
      client.query.mockRejectedValue(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
      // A failed close must not prevent retrying or removing the container.
      client.end.mockRejectedValue(new Error("already disconnected"));
      clients.push(client);
      return client;
    });
    const starting = startIsolatedPostgres("test-timeout");
    const rejection = expect(starting).rejects.toThrow("isolated PostgreSQL did not become ready");
    await vi.advanceTimersByTimeAsync(59_999);

    expect(clients).toHaveLength(80);
    expect(dockerCommands().some((args) => args[0] === "rm")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;

    for (const client of clients) {
      expect(client.query).toHaveBeenCalledExactlyOnceWith("SELECT 1");
      expect(client.end).toHaveBeenCalledOnce();
    }
    const commands = dockerCommands();
    const container = commands[0][commands[0].indexOf("--name") + 1];
    expect(commands.filter((args) => args[0] === "rm")).toEqual([["rm", "-f", container]]);
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});
