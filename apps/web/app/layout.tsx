import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Debugany — Every bug. One place.",
  description: "Application observability, error tracking, and actionable debugging insights."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}