"use client";

import { login } from "@/actions/auth";
import ActionButton from "@/components/ui/action-button";
import { AlertTriangle, LockKeyhole, Server, User } from "lucide-react";
import { useActionState } from "react";

const fieldClass = "ops-input w-full px-3 py-2 pl-9 text-sm";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ops-muted";

export default function LoginPage() {
  const [state, action, isPending] = useActionState(login, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center bg-ops-bg px-4 py-8 text-ops-text">
      <section className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-ops-accent text-slate-950">
            <Server className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-normal font-display">DC Check</h1>
            <p className="text-sm text-ops-muted">Data center audit operations</p>
          </div>
        </div>

        <div className="ops-panel overflow-hidden">
          <div className="border-b border-ops-border bg-ops-surface px-5 py-4">
            <h2 className="text-base font-bold text-ops-text">Sign In</h2>
            <p className="mt-1 text-sm text-ops-muted">Use your operator account to continue.</p>
          </div>

          <form action={action} className="space-y-5 p-5">
            <label>
              <span className={labelClass}>Username</span>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input id="username" name="username" type="text" required className={fieldClass} placeholder="admin" />
              </div>
              {state?.errors?.username && <p className="mt-1 text-sm text-red-300">{state.errors.username}</p>}
            </label>

            <label>
              <span className={labelClass}>Password</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ops-muted" />
                <input id="password" name="password" type="password" required className={fieldClass} placeholder="Password" />
              </div>
              {state?.errors?.password && <p className="mt-1 text-sm text-red-300">{state.errors.password}</p>}
            </label>

            {state?.message && (
              <div className="flex items-start gap-2 rounded-md border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{state.message}</span>
              </div>
            )}

            <ActionButton type="submit" isPending={isPending} className="w-full">
              Sign In
            </ActionButton>
          </form>
        </div>
      </section>
    </main>
  );
}
