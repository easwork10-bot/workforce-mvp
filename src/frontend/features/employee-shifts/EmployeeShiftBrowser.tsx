"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, CheckCircle, Clock, Euro, MapPin, Users } from 'lucide-react';
import { Button } from '@/frontend/ui/button';
import type { EmployeeShift, EmployeeShiftApiErrorKind, EmployeeShiftPage } from './employeeShiftsApi';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/frontend/ui/card';
import {
  applyForEmployeeShift,
  EmployeeShiftApiError,
  fetchEmployeeShifts,
} from './employeeShiftsApi';
import { runOncePerKey } from './runOncePerKey';

function getApiErrorKind(error: unknown): EmployeeShiftApiErrorKind {
  return error instanceof EmployeeShiftApiError ? error.kind : 'server';
}

export default function EmployeeShiftBrowser() {
  const t = useTranslations('employeeShifts');
  const tEmployee = useTranslations('employee');
  const tShifts = useTranslations('shifts');
  const locale = useLocale();

  const [page, setPage] = useState(1);
  const [pageData, setPageData] = useState<EmployeeShiftPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<EmployeeShiftApiErrorKind | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [pendingShiftIds, setPendingShiftIds] = useState<Set<string>>(new Set());
  const [appliedShiftIds, setAppliedShiftIds] = useState<Set<string>>(new Set());
  const [applicationErrors, setApplicationErrors] = useState<Record<string, EmployeeShiftApiErrorKind>>({});
  const [applicationSucceeded, setApplicationSucceeded] = useState(false);
  const pendingRef = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    fetchEmployeeShifts(page, controller.signal)
      .then((result) => {
        if (page > 1 && result.pagination.totalPages > 0 && page > result.pagination.totalPages) {
          setPage(result.pagination.totalPages);
          return;
        }
        if (page > 1 && result.pagination.totalPages === 0) {
          setPage(1);
          return;
        }
        setPageData(result);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(getApiErrorKind(error));
        setPageData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, reloadVersion]);

  const retryLoading = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  const applyToShift = async (shiftId: string) => {
    await runOncePerKey(pendingRef.current, shiftId, async () => {
      setPendingShiftIds((current) => new Set(current).add(shiftId));
      setApplicationErrors((current) => {
        const next = { ...current };
        delete next[shiftId];
        return next;
      });
      setApplicationSucceeded(false);

      try {
        await applyForEmployeeShift(shiftId);
        setAppliedShiftIds((current) => new Set(current).add(shiftId));
        setApplicationSucceeded(true);

        try {
          const refreshed = await fetchEmployeeShifts(page);
          if (page > 1 && refreshed.pagination.totalPages > 0 && page > refreshed.pagination.totalPages) {
            setPage(refreshed.pagination.totalPages);
          } else if (page > 1 && refreshed.pagination.totalPages === 0) {
            setPage(1);
          } else {
            setPageData(refreshed);
          }
        } catch (error) {
          setLoadError(getApiErrorKind(error));
        }
      } catch (error) {
        setApplicationErrors((current) => ({
          ...current,
          [shiftId]: getApiErrorKind(error),
        }));
      } finally {
        setPendingShiftIds((current) => {
          const next = new Set(current);
          next.delete(shiftId);
          return next;
        });
      }
    });
  };

  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  }).format(new Date(value));

  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: locale === 'ar' ? 'Asia/Riyadh' : 'Europe/Amsterdam',
  }).format(new Date(value));

  const formatCompensation = (amount: string | null, type: EmployeeShift['compensationType']) => {
    if (amount === null || amount.length === 0) return t('compensation.notSpecified');

    const value = Number(amount);
    const formatted = Number.isFinite(value)
      ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value)
      : amount;

    switch (type) {
      case 'hourly':
        return t('compensation.hourly', { amount: formatted });
      case 'daily':
        return t('compensation.daily', { amount: formatted });
      default:
        return t('compensation.fixed', { amount: formatted });
    }
  };

  const getErrorMessage = (kind: EmployeeShiftApiErrorKind) => {
    switch (kind) {
      case 'unauthorized':
        return t('errors.unauthorized');
      case 'forbidden':
        return t('errors.forbidden');
      case 'invalid':
        return t('errors.invalid');
      case 'network':
        return t('errors.network');
      case 'csrf':
        return t('errors.csrf');
      default:
        return t('errors.server');
    }
  };

  const shifts = pageData?.shifts ?? [];
  const totalPages = pageData?.pagination.totalPages ?? 0;

  return (
    <main className="container mx-auto space-y-6 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{tEmployee('available.shifts')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </header>

      {applicationSucceeded && (
        <p className="rounded-md border border-green-600/30 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200" role="status">
          {t('applicationSuccess')}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted-foreground" role="status" aria-live="polite">
          {t('loading')}
        </p>
      ) : loadError ? (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <p role="alert">{getErrorMessage(loadError)}</p>
            <Button type="button" variant="outline" onClick={retryLoading}>{t('retry')}</Button>
          </CardContent>
        </Card>
      ) : shifts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto mb-4 h-12 w-12 text-gray-400" aria-hidden="true" />
            <h2 className="text-lg font-medium">{t('emptyTitle')}</h2>
            <p className="mt-1 text-muted-foreground">{t('emptyDescription')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shifts.map((shift) => {
              const isPending = pendingShiftIds.has(shift.id);
              const hasApplied = shift.hasApplied || appliedShiftIds.has(shift.id);

              return (
                <Card key={shift.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-lg">{shift.title}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{shift.workType}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                        {tShifts('status.open')}
                      </span>
                    </div>
                    {shift.clientOrProject && <CardDescription>{shift.clientOrProject}</CardDescription>}
                  </CardHeader>

                  <CardContent className="flex-1 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <time dateTime={shift.startAt}>{formatDate(shift.startAt)}</time>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        <time dateTime={shift.startAt}>{formatTime(shift.startAt)}</time>
                        {' – '}
                        <time dateTime={shift.endAt}>{formatTime(shift.endAt)}</time>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{shift.location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('applicants', { applied: shift.applicationCount, required: shift.requiredWorkers })}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-300">
                      <Euro className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{formatCompensation(shift.compensationAmount, shift.compensationType)}</span>
                    </div>
                    {shift.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{shift.description}</p>}
                  </CardContent>

                  <CardFooter className="flex-col items-stretch gap-3 border-t border-gray-100 p-4 pt-4 dark:border-gray-800">
                    {applicationErrors[shift.id] && (
                      <p className="text-sm text-destructive" role="alert">
                        {getErrorMessage(applicationErrors[shift.id])}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="w-full"
                      variant={hasApplied ? 'secondary' : 'outline'}
                      disabled={hasApplied || isPending}
                      onClick={() => void applyToShift(shift.id)}
                    >
                      {hasApplied ? (
                        <>
                          <CheckCircle className="me-2 h-4 w-4" aria-hidden="true" />
                          {tShifts('application.applied')}
                        </>
                      ) : isPending ? t('applying') : tShifts('apply')}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-4" aria-label={t('pagination.label')}>
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('pagination.previous')}
              </Button>
              <span aria-live="polite">{t('pagination.page', { page, totalPages })}</span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                {t('pagination.next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
