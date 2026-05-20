import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Telegram bot token settings", () => {
  it("stores a Telegram bot token separately from the site chat ID", () => {
    const schema = readFileSync(join(process.cwd(), "db/schema.ts"), "utf8");
    const settingsAction = readFileSync(join(process.cwd(), "actions/settings.ts"), "utf8");
    const settingsForm = readFileSync(join(process.cwd(), "components/admin/settings-form.tsx"), "utf8");

    expect(schema).toContain("telegramBotToken");
    expect(settingsAction).toContain("telegramBotToken");
    expect(settingsForm).toContain('name="telegramBotToken"');
    expect(settingsForm).toContain("Token Bot Telegram");
  });

  it("uses stored bot token as fallback when TELEGRAM_BOT_TOKEN is missing", () => {
    const telegramHelper = readFileSync(join(process.cwd(), "lib/telegram.ts"), "utf8");

    expect(telegramHelper).toContain("getTelegramBotToken");
    expect(telegramHelper).toContain("globalSettings.telegramBotToken");
    expect(telegramHelper).toContain("process.env.TELEGRAM_BOT_TOKEN ||");
  });
});