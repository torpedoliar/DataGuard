"use client";

import { login } from "@/actions/auth";
import ActionButton from "@/components/ui/action-button";
import { AlertTriangle, LockKeyhole, Server, User } from "lucide-react";
import { useActionState } from "react";
import { useTranslations } from "next-intl";

const fieldClass = "ops-input h-11 w-full px-3 py-2 pl-10 text-sm";
const labelClass = "mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(login, undefined);
  const t = useTranslations("Login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-ops-bg px-5 py-10 text-ops-text sm:px-6">
      <section className="w-full max-w-[30rem]">
        <div className="mb-6 flex items-center gap-3 px-1">
          <div className="flex size-10 items-center justify-center rounded-md bg-ops-accent text-slate-950">
            <Server className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-normal font-display">{t("title")}</h1>
            <p className="text-sm text-ops-muted">{t("subtitle")}</p>
          </div>
        </div>

        <div className="ops-panel overflow-hidden">
          <div className="border-b border-ops-border bg-ops-surface px-6 py-5">
            <h2 className="text-base font-bold text-ops-text">{t("heading")}</h2>
            <p className="mt-1 text-sm text-ops-muted">{t("description")}</p>
          </div>

          <form action={action} className="space-y-6 p-6 sm:p-7">
            <label>
              <span className={labelClass}>{t("username")}</span>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input id="username" name="username" type="text" required className={fieldClass} placeholder={t("usernamePlaceholder")} />
              </div>
              {state?.errors?.username && <p className="mt-1 text-sm text-red-300">{state.errors.username}</p>}
            </label>

            <label>
              <span className={labelClass}>{t("password")}</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input id="password" name="password" type="password" required className={fieldClass} placeholder={t("passwordPlaceholder")} />
              </div>
              {state?.errors?.password && <p className="mt-1 text-sm text-red-300">{state.errors.password}</p>}
            </label>

            {state?.message && (
              <div className="flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{state.message}</span>
              </div>
            )}

            <ActionButton type="submit" isPending={isPending} className="h-11 w-full">
              {t("submit")}
            </ActionButton>
          </form>
        </div>
      </section>
    </main>
  );
}
