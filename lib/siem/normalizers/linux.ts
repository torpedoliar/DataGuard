import { normalizeGeneric } from "./generic";

export function normalizeLinux(message: string) {
  const sudo = message.match(/sudo:\s+([^\s:]+).*COMMAND=(.+)$/i);
  if (sudo) return { ...normalizeGeneric(message), category: "System", normalizedType: "sudo_command", action: "sudo", outcome: "success", username: sudo[1], metadata: { command: sudo[2] } };
  if (/oom-killer|out of memory/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "oom_killer", action: "kill", outcome: "failure" };
  if (/disk.*full|no space left/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "disk_full", action: "alert", outcome: "warning" };
  if (/service .*restart|systemd.*started/i.test(message)) return { ...normalizeGeneric(message), category: "System", normalizedType: "service_restart", action: "restart", outcome: "success" };
  return normalizeGeneric(message);
}
