import { createNavigation } from 'next-intl/navigation';
import { defaultLocale, locales, localePrefix } from '@/i18n';

export const {
  Link,
  redirect,
  permanentRedirect,
  usePathname,
  useRouter,
} = createNavigation({ defaultLocale, locales, localePrefix });
