import type { Metadata } from "next";

import { AppFooter } from "@/components/AppFooter";
import { AppNav } from "@/components/AppNav";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppNav />
        <main className="min-h-[70vh]">{children}</main>
        <AppFooter />
      </body>
    </html>
  );
}
