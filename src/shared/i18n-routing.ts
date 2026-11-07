import { createSharedPathnamesNavigation } from 'next-intl/navigation';
import { locales, localePrefix } from '@/i18n';

export const {
  Link,
  redirect,
  permanentRedirect,
  usePathname,
  useRouter,
} = createSharedPathnamesNavigation({ locales, localePrefix });
