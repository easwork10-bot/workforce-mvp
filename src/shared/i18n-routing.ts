import { createSharedPathnamesNavigation } from "next-intl/navigation";

import LocaleAwareLink from "./LocaleAwareLink";

export const locales = ["nl", "ar"] as const;
export type Locale = (typeof locales)[number];
export const localePrefix = "as-needed" as const;

const {
  redirect,
  permanentRedirect,
  usePathname,
  useRouter,
} = createSharedPathnamesNavigation({ locales, localePrefix });

export { LocaleAwareLink as Link, redirect, permanentRedirect, usePathname, useRouter };
