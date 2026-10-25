"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Activity } from "lucide-react";
import { registerAction, type AuthFormState } from "../../actions/auth";

const initial: AuthFormState = { error: null };

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(registerAction, initial);

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark auth-brand"><span className="brand-symbol"><Activity size={18} strokeWidth={2.5} /></span><span>debug<span>any</span></span></div>
        <h1>Create your account</h1>
        <p className="auth-sub">Set up error tracking for your projects.</p>
        <form action={formAction} className="auth-form">
          <label>
            Name
            <input type="text" name="name" autoComplete="name" required />
          </label>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <label>
            Password <small>at least 10 characters</small>
            <input type="password" name="password" autoComplete="new-password" minLength={10} required />
          </label>
          {state.error && <p className="auth-error" role="alert">{state.error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p className="auth-alt">Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
