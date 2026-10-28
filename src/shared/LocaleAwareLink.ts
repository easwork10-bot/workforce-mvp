"use client";

import NextLink from "next/link";
import { useLocale } from "next-intl";
import { createElement, forwardRef, type ComponentProps } from "react";

import { localizeHref } from "./localized-href";

type LinkProps = ComponentProps<typeof NextLink>;

const LocaleAwareLink = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, locale, ...props }, ref) => {
    const currentLocale = useLocale();

    return createElement(NextLink, {
      ...props,
      ref,
      href: localizeHref(
        href,
        typeof locale === "string" ? locale : currentLocale
      ),
    });
  }
);

LocaleAwareLink.displayName = "LocaleAwareLink";

export default LocaleAwareLink;
