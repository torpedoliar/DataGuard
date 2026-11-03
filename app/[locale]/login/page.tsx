"use client";

import { login } from "@/actions/auth";
import ActionButton from "@/components/ui/action-button";
import { AlertTriangle, LockKeyhole, Server, ShieldCheck, User } from "lucide-react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import packageJson from "@/package.json";

const fieldClass = "ops-input h-10 w-full px-3 pl-9 text-sm placeholder:text-ops-subtle";
const labelClass = "mb-1.5 block text-[13px] font-medium text-ops-text";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(login, undefined);
  const t = useTranslations("Login");

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ops-bg px-5 py-10 text-ops-text sm:px-6">
      <div aria-hidden className="ops-grid-bg pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-20%] h-[480px] w-[720px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--color-ops-accent) 14%, transparent), transparent)" }}
      />

      <section className="relative w-full max-w-[380px] animate-enter">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-ops-accent text-ops-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_24px_-8px_color-mix(in_srgb,var(--color-ops-accent)_60%,transparent)]">
            <Server aria-hidden="true" className="size-5" />
          </div>
          <h1 className="font-display text-xl font-semibold tracking-[-0.02em]">{t("title")}</h1>
          <p className="mt-1 text-sm text-ops-muted">{t("subtitle")}</p>
        </div>

        <div className="ops-panel p-6 shadow-[var(--shadow-overlay)] sm:p-7">
          <div className="mb-6">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{t("heading")}</h2>
            <p className="mt-1 text-[13px] text-ops-muted">{t("description")}</p>
          </div>

          <form action={action} className="space-y-4">
            <div>
              <label htmlFor="username" className={labelClass}>{t("username")}</label>
              <div className="relative">
                <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-subtle" />
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  aria-invalid={state?.errors?.username ? true : undefined}
                  aria-describedby={state?.errors?.username ? "username-error" : undefined}
                  className={fieldClass}
                  placeholder={t("usernamePlaceholder")}
                />
              </div>
              {state?.errors?.username && <p id="username-error" className="mt-1.5 text-[13px] text-ops-danger">{state.errors.username}</p>}
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>{t("password")}</label>
              <div className="relative">
                <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-subtle" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={state?.errors?.password ? true : undefined}
                  aria-describedby={state?.errors?.password ? "password-error" : undefined}
                  className={fieldClass}
                  placeholder={t("passwordPlaceholder")}
                />
              </div>
              {state?.errors?.password && <p id="password-error" className="mt-1.5 text-[13px] text-ops-danger">{state.errors.password}</p>}
            </div>

            {state?.message && (
              <div role="alert" className="flex animate-enter items-start gap-2 rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{state.message}</span>
              </div>
            )}

            <ActionButton type="submit" isPending={isPending} className="mt-2 h-10 w-full">
              {t("submit")}
            </ActionButton>
          </form>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ops-subtle">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {t("footer")} · v{packageJson.version}
        </p>
      </section>
    </main>
  );
}
