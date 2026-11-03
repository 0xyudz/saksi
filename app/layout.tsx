import type { Metadata } from "next";

import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { Providers } from "./providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Saksi seals every prediction before the event, verifies it on Sui, remembers analyst bias in Walrus Memory, and pays for premium signals with x402.",
  applicationName: APP_NAME,
};

/**
 * The root layout owns the document only. Each route group renders its own navigation and
 * footer, so the marketing site and the journal can differ without a conditional shell.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
