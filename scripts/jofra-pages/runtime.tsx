import { createContext, useContext, type ReactNode } from "react";
import ar from "../../src/locales/ar.json";
import nl from "../../src/locales/nl.json";

const messages = { nl, ar } as const;
type Locale = keyof typeof messages;

const RuntimeContext = createContext<{
  locale: Locale;
  pathname: string;
  messages: (typeof messages)[Locale];
} | null>(null);

export function JofraRuntime({
  children,
  locale,
  pathname,
}: {
  children: ReactNode;
  locale: Locale;
  pathname: string;
}) {
  return (
    <RuntimeContext.Provider value={{ locale, pathname, messages: messages[locale] }}>
      {children}
    </RuntimeContext.Provider>
  );
}

function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Jofra Pages locale runtime is missing.");
  return runtime;
}

export function useLocale() {
  return useRuntime().locale;
}

export function usePathname() {
  return useRuntime().pathname;
}

export function useTranslations(namespace = "") {
  const runtime = useRuntime();
  return (key: string) => {
    const path = [namespace, key].filter(Boolean).join(".");
    let value: unknown = runtime.messages;
    for (const segment of path.split(".")) {
      if (value === null || typeof value !== "object" || !(segment in value)) {
        throw new Error(`Missing Jofra Pages translation: ${path}`);
      }
      value = (value as Record<string, unknown>)[segment];
    }
    if (typeof value !== "string") {
      throw new Error(`Jofra Pages translation is not text: ${path}`);
    }
    return value;
  };
}
