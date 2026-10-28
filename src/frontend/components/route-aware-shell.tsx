"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Navigation from "@/frontend/components/navigation";
import { SessionProvider } from "@/frontend/components/session-provider";

const LOCALE_HOME_ROUTE = /^\/(nl|ar)(?:\/(?:aanvragen|werken-bij-jofra))?\/?$/;

export default function RouteAwareShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNavigation = LOCALE_HOME_ROUTE.test(pathname);

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
