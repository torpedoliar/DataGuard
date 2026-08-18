import { db } from "../db";
import { globalSettings } from "../db/schema";

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
    return Boolean(process.env.TELEGRAM_BOT_TOKEN || storedToken?.trim());
}

export async function getTelegramBotToken(botTokenOverride?: string | null) {
    const directToken = botTokenOverride?.trim() || process.env.TELEGRAM_BOT_TOKEN || "";
    if (directToken) return directToken;

    try {
        const settings = await db.select({ telegramBotToken: globalSettings.telegramBotToken }).from(globalSettings).limit(1);
        return settings[0]?.telegramBotToken?.trim() || null;
    } catch {
        return null;
    }
}

export function escapeTelegramMarkdown(value: string) {
    return value.replace(/([_*`\[])/g, "\\$1");
}

function normalizeTemplateValue(
    value: string | number | null | undefined,
    allowTrustedMarkdown: boolean,
) {
    const text = String(value ?? "").trim();
    if (!text) return "-";
    return allowTrustedMarkdown ? text : escapeTelegramMarkdown(text);
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
                parse_mode: "Markdown",
            }),
            // A black-holed/half-open connection must not stall the caller
            // (SIEM alert worker ticks, checklist/incident actions) forever.
            signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Telegram API Error:", errorData);
            return { success: false, message: "Gateway rejected request" };
        }

        return { success: true };
    } catch (error) {
        console.error("Failed to send telegram message:", error);
        return { success: false, message: "Network error" };
    }
}