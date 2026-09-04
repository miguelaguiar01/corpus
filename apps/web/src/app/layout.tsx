import type { ReactNode } from "react";
import "./globals.css";

// Chrome strings (metadata, headings, …) arrive with the i18n catalog
// wiring (#13) — this shell deliberately renders no user-facing text.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
