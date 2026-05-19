export const DEFAULT_TELEGRAM_ALERT_TEMPLATE = [
    "*Data Center Audit Alert*",
    "Site: {siteName} ({siteCode})",
    "Auditor: {checker}",
    "Shift: {shift}",
    "Time: {checkDate} {checkTime}",
    "",
    "Device: {deviceName}",
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
] as const;

export type TelegramAlertTemplateField = typeof TELEGRAM_ALERT_TEMPLATE_FIELDS[number];

export type TelegramAlertTemplateContext = Partial<Record<TelegramAlertTemplateField, string | number | null | undefined>>;

export function isTelegramBotConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function escapeTelegramMarkdown(value: string) {
    return value.replace(/([_*`\[])/g, "\\$1");
}

function normalizeTemplateValue(value: string | number | null | undefined) {
    const text = String(value ?? "").trim();
    return text ? escapeTelegramMarkdown(text) : "-";
}

export function renderTelegramTemplate(template: string | null | undefined, context: TelegramAlertTemplateContext) {
    const source = template?.trim() || DEFAULT_TELEGRAM_ALERT_TEMPLATE;
    return source.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key: string) => {
        if (!TELEGRAM_ALERT_TEMPLATE_FIELDS.includes(key as TelegramAlertTemplateField)) return match;
        return normalizeTemplateValue(context[key as TelegramAlertTemplateField]);
    });
}

export async function sendTelegramAlert(chatId: string | null | undefined, message: string) {
    if (!chatId) return { success: false, message: "No chat ID provided" };

    // Uses process.env.TELEGRAM_BOT_TOKEN
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.warn("TELEGRAM_BOT_TOKEN is missing in environment variables.");
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
