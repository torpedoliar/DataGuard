import { db } from "../db";
import { globalSettings } from "../db/schema";
import { getEnv } from "./env";

export const DEFAULT_TELEGRAM_ALERT_TEMPLATE = [
    "*Data Center Audit Alert*",
    "Site: {siteName} ({siteCode})",
    "Open: {incidentLink}",
    "Auditor: {checker}",
    "Shift: {shift}",
    "Time: {checkDate} {checkTime}",
    "",
    "Device: {deviceName}",
    "Asset Code: {deviceAssetCode}",
    "Status: {deviceStatus}",
    "Location: {deviceLocation}",
    "Category: {deviceCategory}",
    "Brand: {deviceBrand}",
    "Zone: {deviceZone}",
    "Rack: {deviceRack}",
    "IP: {deviceIp}",
    "Remarks: {deviceRemarks}",
].join("\n");

export const TELEGRAM_ALERT_TEMPLATE_FIELDS = [
    "siteName",
    "siteCode",
    "checker",
    "shift",
    "checkDate",
    "checkTime",
    "deviceName",
    "deviceAssetCode",
    "deviceStatus",
    "deviceLocation",
    "deviceCategory",
    "deviceBrand",
    "deviceZone",
    "deviceRack",
    "deviceIp",
    "deviceDescription",
    "deviceRemarks",
    "incidentId",
    "incidentLink",
] as const;

export type TelegramAlertTemplateField = typeof TELEGRAM_ALERT_TEMPLATE_FIELDS[number];

export type TelegramAlertTemplateContext = Partial<Record<TelegramAlertTemplateField, string | number | null | undefined>>;

export function isTelegramBotConfigured(storedToken?: string | null) {
    return Boolean(getEnv().TELEGRAM_BOT_TOKEN || storedToken?.trim());
}

export async function getTelegramBotToken(botTokenOverride?: string | null) {
    const directToken = botTokenOverride?.trim() || getEnv().TELEGRAM_BOT_TOKEN || "";
    if (directToken) return directToken;

    try {
        const settings = await db.select({ telegramBotToken: globalSettings.telegramBotToken }).from(globalSettings).limit(1);
        return settings[0]?.telegramBotToken?.trim() || null;
    } catch {
        return null;
    }
}

/**
 * HTML-escape entity-supplied field values for parse_mode=HTML. Telegram only
 * parses the 5 HTML entities for injection (raw text ignores < & > unless the
 * full tag/entity is valid), but we escape conservatively so user content can
 * never close a tag we opened. This supersedes the legacy Markdown escaper
 * (#75): in HTML mode there is no Markdown special-char set to maintain.
 */
export function escapeTelegramHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert a trusted, server-generated Markdown link (`[label](https://url)`)
 * into an HTML anchor. Only http(s) URLs are accepted so entity input can
 * never smuggle javascript:/data: hrefs; anything that does not match the
 * shape is HTML-escaped as plain text instead of being emitted raw.
 */
function renderTrustedLink(value: string): string {
  const match = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(value.trim());
  if (!match) return escapeTelegramHtml(value);
  const [, label, url] = match;
  return `<a href="${escapeTelegramHtml(url)}">${escapeTelegramHtml(label)}</a>`;
}

function normalizeTemplateValue(
    value: string | number | null | undefined,
    allowTrustedMarkdown: boolean,
) {
    const text = String(value ?? "").trim();
    if (!text) return "-";
    if (allowTrustedMarkdown) return renderTrustedLink(text);
    return escapeTelegramHtml(text);
}

export type TelegramTemplateRenderOptions = {
    /**
     * Only generated, server-controlled Markdown may be opted out of escaping.
     * Keep this allowlist narrow: user/device fields must remain escaped.
     */
    trustedMarkdownFields?: readonly ["incidentLink"] | readonly ("incidentLink")[];
};

export function renderTelegramTemplate(
    template: string | null | undefined,
    context: TelegramAlertTemplateContext,
    options: TelegramTemplateRenderOptions = {},
) {
    const source = template?.trim() || DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    const trustedMarkdownFields = new Set(options.trustedMarkdownFields ?? []);

    return source.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key: string) => {
        if (!TELEGRAM_ALERT_TEMPLATE_FIELDS.includes(key as TelegramAlertTemplateField)) return match;
        const allowTrustedMarkdown = key === "incidentLink" && trustedMarkdownFields.has("incidentLink");
        return normalizeTemplateValue(context[key as TelegramAlertTemplateField], allowTrustedMarkdown);
    });
}

export const TELEGRAM_FETCH_TIMEOUT_MS = 10_000;

export async function sendTelegramAlert(chatId: string | null | undefined, message: string, botTokenOverride?: string | null) {
    if (!chatId) return { success: false, message: "No chat ID provided" };

    const botToken = await getTelegramBotToken(botTokenOverride);
    if (!botToken) {
        console.warn("TELEGRAM_BOT_TOKEN is missing in environment variables and settings.");
        return { success: false, message: "Telegram bot token missing" };
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                // #58/#75: Markdown v1 is legacy and injectable through
                // entity-supplied fields; HTML mode with explicit escaping is
                // the safe rendering path.
                parse_mode: "HTML",
            }),
            // A black-holed/half-open connection must not stall the caller
            // (SIEM alert worker ticks, checklist/incident actions) forever.
            signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            // Telegram can return non-JSON error bodies (proxy HTML, plain-text
            // 429s); read as text and try JSON so the real API error surfaces.
            const rawBody = await response.text();
            let detail = rawBody.trim();
            try {
                const parsed = JSON.parse(rawBody) as { description?: unknown; error_data?: { description?: unknown } };
                const apiDescription = parsed.description ?? parsed.error_data?.description;
                if (typeof apiDescription === "string" && apiDescription.trim()) {
                    detail = apiDescription.trim();
                }
            } catch {
                // Non-JSON body — keep the raw text as the detail.
            }
            console.error("Telegram API Error:", detail || "Gateway rejected request");
            return { success: false, message: detail || "Gateway rejected request" };
        }

        return { success: true };
    } catch (error) {
        console.error("Failed to send telegram message:", error);
        return { success: false, message: "Network error" };
    }
}

// Finding #22: Telegram drops messages over 4096 chars whole, so combined
// alerts are split on device-block separators into <=4000-char pieces.
export const TELEGRAM_CHUNK_SEPARATOR = "\n\n---\n\n";
export const TELEGRAM_CHUNK_MAX_LENGTH = 4000;

/**
 * Send a photo via sendPhoto (multipart upload), captioned. Evidence photos
 * for checklist alerts: only https (public) URLs and raw Buffers are
 * accepted — the app's own base URL is usually internal, so the caller
 * passes the file bytes instead of a link Telegram's servers can't fetch.
 * Never throws (same contract as sendTelegramAlert).
 */
export async function sendTelegramPhoto(
  chatId: string | null | undefined,
  photo: Buffer,
  filename: string,
  caption: string,
  botTokenOverride?: string | null,
): Promise<{ success: boolean; message?: string }> {
  if (!chatId) return { success: false, message: "No chat ID provided" };

  const botToken = await getTelegramBotToken(botTokenOverride);
  if (!botToken) {
    return { success: false, message: "Telegram bot token missing" };
  }

  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption.slice(0, 1024)); // Telegram caption cap
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([new Uint8Array(photo)]), filename);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS * 3), // upload is slower
    });

    if (!response.ok) {
      const rawBody = await response.text();
      let detail = rawBody.trim();
      try {
        const parsed = JSON.parse(rawBody) as { description?: unknown; error_data?: { description?: unknown } };
        const apiDescription = parsed.description ?? parsed.error_data?.description;
        if (typeof apiDescription === "string" && apiDescription.trim()) {
          detail = apiDescription.trim();
        }
      } catch {
        // Non-JSON body — keep the raw text as the detail.
      }
      return { success: false, message: detail || "Gateway rejected request" };
    }

    return { success: true };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Network error" };
  }
}

export function splitTelegramChunks(messages: string[], maxLength: number = TELEGRAM_CHUNK_MAX_LENGTH): string[] {
    const chunks: string[] = [];
    let current = "";
    const separator = TELEGRAM_CHUNK_SEPARATOR;

    for (const message of messages) {
        if (message.length > maxLength) {
            // A single rendered block that alone exceeds the cap: keep it
            // reachable but truncated (Telegram would drop it otherwise).
            if (current) {
                chunks.push(current);
                current = "";
            }
            console.warn(
                `[checklist] telegram alert block of ${message.length} chars exceeds the ${maxLength}-char chunk cap; truncating`,
            );
            chunks.push(`${message.slice(0, maxLength - 1)}…`);
            continue;
        }

        const candidate = current ? `${current}${separator}${message}` : message;
        if (candidate.length > maxLength) {
            chunks.push(current);
            current = message;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}