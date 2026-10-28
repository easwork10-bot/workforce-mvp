"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent } from '@/frontend/ui/card';
import {
  EmployeeApplicationsApiError,
  fetchEmployeeApplications,
  type EmployeeApplication,
  type EmployeeApplicationPage,
  type EmployeeApplicationsApiErrorKind,
} from './employeeApplicationsApi';

type EmployeeApplicationsListProps = {
  limit?: number;
  compact?: boolean;
};

function getErrorKind(error: unknown): EmployeeApplicationsApiErrorKind {
  return error instanceof EmployeeApplicationsApiError ? error.kind : 'server';
}

function statusClass(status: EmployeeApplication['status']): string {
  switch (status) {
    case 'accepted':
      return 'bg-success-light text-success';
    case 'rejected':
      return 'bg-destructive-light text-destructive';
    case 'pending':
      return 'bg-warning-light text-warning';
    case 'cancelled':
      return 'bg-muted text-muted-foreground';
  }
}

export default function EmployeeApplicationsList({
  limit = 20,
  compact = false,
}: EmployeeApplicationsListProps) {
  const t = useTranslations('employeeApplications');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EmployeeApplicationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EmployeeApplicationsApiErrorKind | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchEmployeeApplications(page, limit, controller.signal)
      .then((result) => {
        if (page > 1 && page > result.pagination.totalPages) {
          setPage(Math.max(result.pagination.totalPages, 1));
          return;
        }
        setData(result);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(getErrorKind(caught));
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [limit, page, reloadVersion]);

  const retry = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  }).format(new Date(value));

  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  }).format(new Date(value));

  const errorMessage = error ? t(`errors.${error}`) : null;
  const applications = data?.applications ?? [];

  if (loading) {
    return (
      <p className="py-8 text-center text-muted-foreground" role="status" aria-live="polite">
        {t('loading')}
      </p>
    );
  }

  if (errorMessage) {
    return (
      <Card>
        <CardContent className="space-y-4 py-8 text-center">
          <p role="alert">{errorMessage}</p>
          <Button type="button" variant="outline" onClick={retry}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }

  if (applications.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <h2 className="font-medium">{t('emptyTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyDescription')}</p>
          <Button asChild className="mt-5">
            <Link href="/employee/shifts">{t('browseShifts')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      {compact && data && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('total', { count: data.pagination.total })}
        </p>
      )}
      <ul className="divide-y divide-border">
        {applications.map((application) => (
          <li key={application.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <h2 className="font-medium">{application.shift.title}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    <time dateTime={application.shift.startAt}>
                      {formatDate(application.shift.startAt)}
                    </time>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                    <time dateTime={application.shift.startAt}>
                      {formatTime(application.shift.startAt)}
                    </time>
                    <span aria-hidden="true">–</span>
                    <time dateTime={application.shift.endAt}>
                      {formatTime(application.shift.endAt)}
                    </time>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {application.shift.location}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('appliedAt', { date: formatDate(application.appliedAt) })}
                </p>
              </div>
              <span className={`inline-flex w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(application.status)}`}>
                {t(`status.${application.status}`)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {!compact && data && data.pagination.totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-4" aria-label={t('pagination.label')}>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            {t('pagination.previous')}
          </Button>
          <span aria-live="polite">
            {t('pagination.page', { page, totalPages: data.pagination.totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => setPage((current) => Math.min(data.pagination.totalPages, current + 1))}
            disabled={page >= data.pagination.totalPages}
          >
            {t('pagination.next')}
          </Button>
        </nav>
      )}
    </div>
  );
}
