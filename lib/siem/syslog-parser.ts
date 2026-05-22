export type ParsedSyslogMessage = {
  parser: "rfc3164" | "rfc5424" | "fallback";
  priority: number | null;
  facility: number | null;
  severity: number | null;
  eventTime: Date | null;
  hostname: string | null;
  appName: string | null;
  program: string | null;
  processId: string | null;
  messageId: string | null;
  structuredData: string | null;
  message: string;
  parseError: string | null;
};

export function decodePriority(priority: number) {
  return { facility: Math.floor(priority / 8), severity: priority % 8 };
}

const rfc5424Pattern = /^<(\d{1,3})>1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s?(.*)$/;
const rfc3164Pattern = /^<(\d{1,3})>([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+):\s?(.*)$/;

function parseRfc3164Date(value: string) {
  const year = new Date().getFullYear();
  const date = new Date(`${value} ${year}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseSyslogMessage(raw: string): ParsedSyslogMessage {
  const rfc5424 = raw.match(rfc5424Pattern);
  if (rfc5424) {
    const priority = Number(rfc5424[1]);
    const decoded = decodePriority(priority);
    const eventTime = new Date(rfc5424[2]);
    return {
      parser: "rfc5424",
      priority,
      ...decoded,
      eventTime: Number.isNaN(eventTime.getTime()) ? null : eventTime,
      hostname: rfc5424[3] === "-" ? null : rfc5424[3],
      appName: rfc5424[4] === "-" ? null : rfc5424[4],
      program: null,
      processId: rfc5424[5] === "-" ? null : rfc5424[5],
      messageId: rfc5424[6] === "-" ? null : rfc5424[6],
      structuredData: rfc5424[7] === "-" ? null : rfc5424[7],
      message: rfc5424[8] || "",
      parseError: null,
    };
  }

  const rfc3164 = raw.match(rfc3164Pattern);
  if (rfc3164) {
    const priority = Number(rfc3164[1]);
    const decoded = decodePriority(priority);
    return {
      parser: "rfc3164",
      priority,
      ...decoded,
      eventTime: parseRfc3164Date(rfc3164[2]),
      hostname: rfc3164[3],
      appName: null,
      program: rfc3164[4],
      processId: null,
      messageId: null,
      structuredData: null,
      message: rfc3164[5],
      parseError: null,
    };
  }

  return {
    parser: "fallback",
    priority: null,
    facility: null,
    severity: null,
    eventTime: null,
    hostname: null,
    appName: null,
    program: null,
    processId: null,
    messageId: null,
    structuredData: null,
    message: raw,
    parseError: "Unsupported syslog format",
  };
}
