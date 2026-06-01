import { normalizeGeneric } from "./generic";

export function normalizeCisco(message: string) {
  const link = message.match(/%LINK-\d-UPDOWN: Interface ([^,]+), changed state to (down|up)/i);
  if (link) return { ...normalizeGeneric(`interface ${link[1]} link ${link[2]}`), metadata: { ciscoMnemonic: "LINK-UPDOWN" } };
  const login = /%SEC_LOGIN-\d-LOGIN_FAILED/i.test(message);
  if (login) return { ...normalizeGeneric(`failed password ${message}`), metadata: { ciscoMnemonic: "SEC_LOGIN" } };
  if (/%SYS-5-CONFIG_I/i.test(message)) return { ...normalizeGeneric("config changed"), metadata: { ciscoMnemonic: "SYS-CONFIG" } };
  if (/%SYS-5-RESTART/i.test(message)) return { ...normalizeGeneric("restarted"), metadata: { ciscoMnemonic: "SYS-RESTART" } };
  return normalizeGeneric(message);
}
