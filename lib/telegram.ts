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
