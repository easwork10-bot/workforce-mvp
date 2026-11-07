'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/shared/i18n-routing';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import {
  AdminShiftApiError,
  fetchAdminShifts,
  publishAdminShift,
  type AdminShiftPage as ShiftPage,
  type AdminShift,
  type AdminShiftQuery,
} from './adminShiftsApi';
import { Plus } from 'lucide-react';

const statuses = ['draft', 'open', 'filled', 'cancelled', 'completed'] as const;
type StatusFilter = AdminShift['status'] | '';

function statusStyle(status: AdminShift['status']): string {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    case 'open': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'filled': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
    case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  }
}

export default function AdminShiftList() {
  const tShifts = useTranslations('shifts');
  const tManagement = useTranslations('adminShiftManagement');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('');
  const [result, setResult] = useState<ShiftPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadShifts = useCallback(async (query: AdminShiftQuery, signal: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAdminShifts(query, signal);
      if (signal.aborted) return;
      const requestedPage = query.page ?? 1;
      if (requestedPage > 1 && requestedPage > response.pagination.totalPages) {
        setPage(Math.max(response.pagination.totalPages, 1));
        return;
      }
      setResult(response);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(requestError instanceof AdminShiftApiError
        ? requestError.message
        : tManagement('loadError'));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [tManagement]);

  useEffect(() => {
    const controller = new AbortController();
    void loadShifts({ page, limit: 20, ...(status ? { status } : {}) }, controller.signal);
    return () => controller.abort();
  }, [loadShifts, page, reloadKey, status]);

  const publish = async (shift: AdminShift) => {
    setPublishingId(shift.id);
    setPublishError(null);
    try {
      await publishAdminShift(shift.id);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      setPublishError(requestError instanceof AdminShiftApiError
        ? requestError.message
        : tManagement('publishError'));
    } finally {
      setPublishingId(null);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam',
    dateStyle: 'medium',
  });
  const timeFormatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit',
  });
  const pageCount = result?.pagination.totalPages ?? 0;

  return (
    <div className="container mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tShifts('list')}</h1>
          <p className="mt-1 text-muted-foreground">{tManagement('description')}</p>
        </div>
        <Link href="/admin/shifts/create">
          <Button className="w-full gap-2 sm:w-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {tShifts('create')}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{tShifts('list')}</CardTitle>
              <CardDescription>{tManagement('listDescription')}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="shift-status" className="text-sm font-medium">{tManagement('statusFilter')}</label>
              <select
                id="shift-status"
                className="input min-h-10"
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(statuses.find((value) => value === event.target.value) ?? '');
                }}
              >
                <option value="">{tManagement('allStatuses')}</option>
                {statuses.map((value) => (
                  <option key={value} value={value}>{tShifts(`status.${value}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {publishError && (
            <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300" role="alert">
              {publishError}
            </p>
          )}
          {loading && <p className="py-8 text-center text-muted-foreground" role="status">{tManagement('loading')}</p>}
          {!loading && error && (
            <div className="space-y-3 py-8 text-center" role="alert">
              <p className="text-red-700 dark:text-red-300">{error}</p>
              <Button variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
                {tManagement('retry')}
              </Button>
            </div>
          )}
          {!loading && !error && result?.shifts.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">{tManagement('empty')}</p>
          )}
          {!loading && !error && result && result.shifts.length > 0 && (
            <>
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {result.shifts.map((shift) => (
                  <li key={shift.id} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold">{shift.title}</h2>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(shift.status)}`}>
                          {tShifts(`status.${shift.status}`)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {dateFormatter.format(new Date(shift.startAt))}
                        {' · '}
                        {timeFormatter.format(new Date(shift.startAt))}
                        {'–'}
                        {timeFormatter.format(new Date(shift.endAt))}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {shift.workType}{shift.clientOrProject ? ` · ${shift.clientOrProject}` : ''}
                        {' · '}{shift.location}
                      </p>
                      <p className="text-sm">
                        {tManagement('assignedWorkers')}: <span className="font-medium">{shift.assignedCount} / {shift.requiredWorkers}</span>
                      </p>
                    </div>
                    {shift.status === 'draft' && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={publishingId !== null}
                        onClick={() => void publish(shift)}
                      >
                        {publishingId === shift.id ? tManagement('publishing') : tManagement('publish')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {pageCount > 1 && (
                <nav className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800" aria-label={tManagement('listDescription')}>
                  <Button
                    variant="outline"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    {tManagement('previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {tManagement('pageOf', { page, total: pageCount })}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page >= pageCount || loading}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  >
                    {tManagement('next')}
                  </Button>
                </nav>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
