import type { Metadata } from "next";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.title"),
  description: t("app.tagline"),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
