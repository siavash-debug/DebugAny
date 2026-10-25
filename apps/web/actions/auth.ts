"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { apiLogin, apiLogout, apiRegister } from "../lib/api";
import { clearSessionCookie, setSessionCookie } from "../lib/session";

export type AuthFormState = { error: string | null };

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const result = await apiLogin(email, password);
  if (!result.ok) {
    return { error: result.message };
  }
  await setSessionCookie(result.data.token);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!name || !email || !password) {
    return { error: "All fields are required." };
  }
  if (password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }

  const result = await apiRegister(email, password, name);
  if (!result.ok) {
    return { error: result.message };
  }
  await setSessionCookie(result.data.token);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await apiLogout();
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect("/login");
}
