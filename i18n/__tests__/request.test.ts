import { describe, it, expect } from "vitest";
import { routing } from "../routing";

// These tests cover the *behavior* of the request config: locale validation,
// fallback to default, and message bundle selection per locale. The actual
// `getRequestConfig` from next-intl resolves to a Client Components stub in
// vitest's RSC-less environment, so we re-derive the same logic here and
// keep it aligned with `i18n/request.ts`.
type RequestLocaleInput = Promise<string | null | undefined> | string | null | undefined;

async function resolveLocale(requestLocale: RequestLocaleInput): Promise<string> {
    const locale = await requestLocale;
    if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
        return routing.defaultLocale;
    }
    return locale;
}

async function loadRequestConfig(requestLocale: RequestLocaleInput) {
    const locale = await resolveLocale(requestLocale);
    const messages = (await import(`../../messages/${locale}.json`)).default;
    return { locale, messages };
}

describe("i18n request config", () => {
    it("exposes en/id locales, id default, as-needed prefix", () => {
        expect(routing.locales).toEqual(["en", "id"]);
        expect(routing.defaultLocale).toBe("id");
        expect(routing.localePrefix).toBe("as-needed");
    });

    it("falls back to default locale when requestLocale is missing or invalid", async () => {
        const cfgMissing = await loadRequestConfig(Promise.resolve(null));
        expect(cfgMissing.locale).toBe(routing.defaultLocale);
        expect(cfgMissing.messages).toBeDefined();
        expect(cfgMissing.messages.Common).toBeDefined();

        const cfgInvalid = await loadRequestConfig(Promise.resolve("fr"));
        expect(cfgInvalid.locale).toBe(routing.defaultLocale);
    });

    it("loads the correct message bundle for each supported locale", async () => {
        const en = await loadRequestConfig("en");
        expect(en.locale).toBe("en");
        expect(en.messages.Common.save).toBe("Save");
        expect(en.messages.Common.cancel).toBe("Cancel");

        const id = await loadRequestConfig("id");
        expect(id.locale).toBe("id");
        expect(id.messages.Common.save).toBe("Simpan");
        expect(id.messages.Common.cancel).toBe("Batal");
    });
});
