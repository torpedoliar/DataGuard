export const PORT_NAMING_TEMPLATES = [
  { id: "custom", label: "Custom", needsSlot: false, needsSubslot: false },
  { id: "ethernet", label: "Ethernet", needsSlot: false, needsSubslot: false },
  { id: "gigabit", label: "GigabitEthernet", needsSlot: true, needsSubslot: true },
  { id: "tenGigabit", label: "TenGigabitEthernet", needsSlot: true, needsSubslot: true },
  { id: "fortyGigabit", label: "FortyGigabitEthernet", needsSlot: true, needsSubslot: true },
  { id: "hundredGigabit", label: "HundredGigabitEthernet", needsSlot: true, needsSubslot: true },
  { id: "management", label: "Management", needsSlot: false, needsSubslot: false },
] as const;

export const BULK_PORT_NAMING_TEMPLATES = PORT_NAMING_TEMPLATES.filter((template) => template.id !== "custom");

export type PortNamingTemplateId = typeof PORT_NAMING_TEMPLATES[number]["id"];

export type PortNamingParams = {
  customName?: string;
  slot?: string;
  subslot?: string;
  port?: string | number;
};

const prefixes: Record<Exclude<PortNamingTemplateId, "custom">, string> = {
  ethernet: "Eth",
  gigabit: "Gi",
  tenGigabit: "Te",
  fortyGigabit: "Fo",
  hundredGigabit: "Hu",
  management: "mgmt",
};

function requiredValue(value: string | number | undefined, message: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(message);
  return text;
}

export function getPortNamingTemplate(templateId: PortNamingTemplateId) {
  const template = PORT_NAMING_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error("Unknown port naming template");
  return template;
}

export function formatPortName(templateId: PortNamingTemplateId, params: PortNamingParams) {
  const template = getPortNamingTemplate(templateId);
  if (template.id === "custom") return requiredValue(params.customName, "Port name is required");

  const port = requiredValue(params.port, "Port number is required");
  const prefix = prefixes[template.id];
  if (!template.needsSlot) return `${prefix}${port}`;

  const slot = requiredValue(params.slot, "Slot is required");
  const subslot = requiredValue(params.subslot, "Subslot is required");
  return `${prefix}${slot}/${subslot}/${port}`;
}

export function buildPortNameRange(templateId: PortNamingTemplateId, params: PortNamingParams, start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error("Invalid port range");
  if (end - start + 1 > 100) throw new Error("Maximum 100 ports can be generated at once");

  return Array.from({ length: end - start + 1 }, (_, index) =>
    formatPortName(templateId, { ...params, port: start + index }),
  );
}

