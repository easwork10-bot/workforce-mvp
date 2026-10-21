// Date formatting helpers for Dutch and Arabic
export const formatDate = (date: Date | string, locale: 'nl' | 'ar' | 'en' = 'nl') => {
  const d = typeof date === 'string' ? new Date(date) : date;

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  };

  return d.toLocaleDateString(locale, options);
};

export const formatDateShort = (date: Date | string, locale: 'nl' | 'ar' | 'en' = 'nl') => {
  const d = typeof date === 'string' ? new Date(date) : date;

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  };

  return d.toLocaleDateString(locale, options);
};

export const formatTime = (date: Date | string, locale: 'nl' | 'ar' | 'en' = 'nl') => {
  const d = typeof date === 'string' ? new Date(date) : date;

  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  };

  return d.toLocaleTimeString(locale, options);
};

// Calculate shift duration in hours
export const calculateDuration = (start: Date | string, end: Date | string): number => {
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;

  return (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
};

// Get current user's locale from session or URL
export const getUserLocale = (urlLocale?: string): 'nl' | 'ar' | 'en' => {
  if (urlLocale) {
    return ['nl', 'ar'].includes(urlLocale) ? urlLocale as 'nl' | 'ar' : 'nl';
  }
  return 'nl';
};