import type { ReactNode } from "react";

import { AppFooter } from "@/components/AppFooter";
import { AppNav } from "@/components/AppNav";

/**
 * Chrome for the working application. The marketing pages live in `(marketing)` and get
 * their own navigation, so the product nav never appears on the landing page and the
 * landing nav never appears inside the journal.
 */
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <AppNav />
      <main className="min-h-[70vh]">{children}</main>
      <AppFooter />
    </>
  );
}
