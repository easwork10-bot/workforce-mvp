"use client";

import { ReactNode } from "react";
import { usePathname } from "@/shared/i18n-routing";
import Navigation from "@/frontend/components/navigation";
import { SessionProvider } from "@/frontend/components/session-provider";

const PUBLIC_JOFRA_ROUTE = /^\/(?:aanvragen|werken-bij-jofra)?\/?$/;

export default function RouteAwareShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNavigation = PUBLIC_JOFRA_ROUTE.test(pathname);

  if (hideNavigation) {
    return <>{children}</>;
  }

  return (
    <SessionProvider>
      <Navigation />
      <div className="pt-16">{children}</div>
    </SessionProvider>
  );
}
