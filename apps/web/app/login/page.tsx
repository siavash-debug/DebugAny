"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Activity } from "lucide-react";
import { loginAction, type AuthFormState } from "../../actions/auth";

const initial: AuthFormState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark auth-brand"><span className="brand-symbol"><Activity size={18} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        <h1>Sign in</h1>
        <p className="auth-sub">Every bug. One place.</p>
        <form action={formAction} className="auth-form">
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          {state.error && <p className="auth-error" role="alert">{state.error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-alt">No account? <Link href="/register">Create one</Link></p>
      </div>
    </main>
  );
}
