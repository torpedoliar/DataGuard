import { describe, expect, it } from "vitest";
import { buildProviderIncidentDrafts, matchEndpointForDeviceId } from "./provider-targets";

describe("buildProviderIncidentDrafts", () => {
  it("takes entity ids only from explicit provider fields", () => {
    const { drafts } = buildProviderIncidentDrafts([
      {
        id: "INC-1",
        status: "new",
        // Record form: the map key is the entity id (schema injects entityId).
        entities: {
          "entity-abc": { md5: "d41d8cd98f00b204e9800998ecf8427e" },
        },
      },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.providerStatus).toBe("new");
    expect(drafts[0]!.targets).toHaveLength(1);
    expect(drafts[0]!.targets[0]).toMatchObject({ entityId: "entity-abc", providerDeviceId: null });
  });

  it("never derives a device id from an entity id or vice versa", () => {
    const { drafts } = buildProviderIncidentDrafts([
      { id: "INC-2", entities: [{ entityId: "entity-1" }, { device_id: "dev-9" }] },
    ]);
    expect(drafts[0]!.targets).toMatchObject([
      { entityId: "entity-1", providerDeviceId: null },
      { entityId: null, providerDeviceId: "dev-9" },
    ]);
  });

  it("keeps the incident draft with zero targets when entities are missing", () => {
    const { drafts, ignored } = buildProviderIncidentDrafts([{ id: "INC-3" }]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.targets).toEqual([]);
    expect(ignored).toEqual([]);
  });

  it("ignores incidents without an id and entities without any identity", () => {
    const { drafts, ignored } = buildProviderIncidentDrafts([
      { entities: [{ md5: "x" }] },
      { id: "INC-4", entities: [null, 42] },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.targets).toEqual([]);
    expect(ignored).toMatchObject([
      { tsIncidentId: null, reason: "missing_incident_id" },
      { tsIncidentId: "INC-4", reason: "unidentifiable_entities:2" },
    ]);
  });
});

describe("matchEndpointForDeviceId", () => {
  const endpoints = [
    { id: 1, wgDeviceId: "dev-1" },
    { id: 2, wgDeviceId: "dev-2" },
    { id: 3, wgDeviceId: null },
  ];

  it("matches only an exact single device id", () => {
    expect(matchEndpointForDeviceId("dev-2", endpoints)).toBe(2);
    expect(matchEndpointForDeviceId("dev-missing", endpoints)).toBeNull();
  });

  it("treats duplicate device ids as ambiguous and never picks one", () => {
    const duplicated = [...endpoints, { id: 9, wgDeviceId: "dev-1" }];
    expect(matchEndpointForDeviceId("dev-1", duplicated)).toBeNull();
  });
});
