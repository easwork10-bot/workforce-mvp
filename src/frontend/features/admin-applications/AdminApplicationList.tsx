'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardHeader } from '@/frontend/ui/card';
import {
  applicationStatuses, type AdminApplicationPage, type ApplicationStatus,
} from '@/shared/admin-applications';
import { AdminApplicationApiError, fetchAdminApplications, reviewAdminApplication } from './adminApplicationsApi';

const conflictCodes = [
  'APPLICATION_DECISION_CONFLICT', 'SHIFT_UNAVAILABLE', 'CAPACITY_REACHED',
  'ACTIVE_ASSIGNMENT_EXISTS', 'APPLICATION_NOT_FOUND',
] as const;

export default function AdminApplicationList() {
  const t = useTranslations('adminApplicationManagement');
  const tShifts = useTranslations('shifts');
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ApplicationStatus | ''>('pending');
  const [data, setData] = useState<AdminApplicationPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);

  const errorMessage = useCallback((error: unknown, fallback: 'loadError' | 'reviewError'): string => {
    if (error instanceof AdminApplicationApiError) {
      if (error.status === 401) return t('unauthorized');
      if (error.status === 403) return t('forbidden');
      const code = conflictCodes.find(value => value === error.code);
      if (code) return t(`errors.${code}`);
    }
    return t(fallback);
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void fetchAdminApplications(page, status || undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (page > 1 && page > result.pagination.totalPages) {
        setPage(Math.max(1, result.pagination.totalPages));
        return;
      }
      setData(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoadError(errorMessage(error, 'loadError'));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [page, status, reload, errorMessage]);

  const refresh = () => {
    setData(null);
    setLoading(true);
    setSelectedId(null);
    setReason('');
    setReload(value => value + 1);
  };

  const review = async (id: string, decision: 'accepted' | 'rejected') => {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await reviewAdminApplication(id, decision, reason.trim());
      setFeedback({ error: false, message: t(result.replayed ? 'replayed' : decision === 'accepted' ? 'approved' : 'rejected') });
    } catch (error) {
      setFeedback({ error: true, message: errorMessage(error, 'reviewError') });
    } finally {
      refresh();
      submitting.current = false;
      setSaving(false);
    }
  };

  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short',
  });
  const time = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
  });
  const pages = data?.pagination.totalPages ?? 0;

  return (
    <main className="container mx-auto space-y-5 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </header>
      {feedback && (
        <p role={feedback.error ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm ${feedback.error
          ? 'border-red-200 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
          : 'border-green-200 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'}`}>
          {feedback.message}
        </p>
      )}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="application-status" className="text-sm font-medium">{t('filter')}</label>
            <select id="application-status" className="input min-h-10 max-w-full" value={status} disabled={saving}
              onChange={event => {
                setStatus(applicationStatuses.find(value => value === event.target.value) ?? '');
                setPage(1);
                setData(null);
                setLoading(true);
                setSelectedId(null);
                setReason('');
                setFeedback(null);
              }}>
              <option value="">{t('all')}</option>
              {applicationStatuses.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </div>
          <Button type="button" variant="outline" disabled={saving || loading} onClick={refresh}>{t('refresh')}</Button>
        </CardHeader>
        <CardContent aria-busy={loading || saving}>
          {loading && <p role="status" className="py-6 text-muted-foreground">{t('loading')}</p>}
          {!loading && loadError && (
            <div className="space-y-3 py-6">
              <p role="alert" className="text-red-700 dark:text-red-300">{loadError}</p>
              <Button variant="outline" onClick={refresh}>{t('retry')}</Button>
            </div>
          )}
          {!loading && !loadError && data && (
            <>
              {data.applications.length === 0 && <p className="py-6 text-muted-foreground">{t('empty')}</p>}
              <ul className="divide-y divide-border">
                {data.applications.map(application => (
                  <li key={application.id} className="min-w-0 space-y-3 py-4 first:pt-0">
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1fr_7rem] lg:items-start">
                      <div className="min-w-0 space-y-1 break-words">
                        <h2 className="font-semibold">{application.employee.fullName}</h2>
                        <p className="text-sm text-muted-foreground">{t('submitted', { date: date.format(new Date(application.appliedAt)) })}</p>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${application.status === 'pending'
                          ? 'bg-orange-100 text-orange-900' : 'bg-muted text-foreground'}`}>
                          {t(`status.${application.status}`)}
                        </span>
                      </div>
                      <div className="min-w-0 space-y-1 break-words text-sm">
                        <h3 className="font-medium">{application.shift.title}</h3>
                        <p>{date.format(new Date(application.shift.startAt))} – {time.format(new Date(application.shift.endAt))}</p>
                        <p className="text-muted-foreground">{application.shift.location}</p>
                      </div>
                      <div className="min-w-0 space-y-1 text-sm">
                        <p>{tShifts(`status.${application.shift.status}`)}</p>
                        <p>{t('capacity', { assigned: application.shift.assignedCount, required: application.shift.requiredWorkers })}</p>
                        <p className="text-muted-foreground">{t('remaining', {
                          count: Math.max(0, application.shift.requiredWorkers - application.shift.assignedCount),
                        })}</p>
                      </div>
                      {application.status === 'pending' && (
                        <Button type="button" variant="outline" disabled={saving}
                          onClick={() => { setSelectedId(application.id); setReason(''); }}>
                          {t('review')}
                        </Button>
                      )}
                    </div>
                    {application.rejectionReason && <p className="break-words text-sm">{t('reason')}: {application.rejectionReason}</p>}
                    {application.status === 'pending' && selectedId === application.id && (
                      <section className="space-y-3 rounded-md border bg-muted/40 p-3" aria-label={t('reviewFor', { name: application.employee.fullName })}>
                        <h3 className="text-sm font-semibold">{t('reviewFor', { name: application.employee.fullName })}</h3>
                        <label className="block space-y-1 text-sm">
                          <span>{t('reasonOptional')}</span>
                          <textarea className="input block min-h-20 w-full" maxLength={1000} value={reason}
                            disabled={saving} onChange={event => setReason(event.target.value)} />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" className="bg-orange-600 text-white hover:bg-orange-700" disabled={saving} onClick={() => void review(application.id, 'accepted')}>
                            {saving ? t('saving') : t('approve')}
                          </Button>
                          <Button type="button" variant="outline" disabled={saving} onClick={() => void review(application.id, 'rejected')}>
                            {t('reject')}
                          </Button>
                          <Button type="button" variant="ghost" disabled={saving} onClick={() => setSelectedId(null)}>{t('close')}</Button>
                        </div>
                      </section>
                    )}
                  </li>
                ))}
              </ul>
              <nav aria-label={t('pagination')} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
                <p>{t('page', { page, pages: Math.max(1, pages), total: data.pagination.total })}</p>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={saving || page <= 1} onClick={() => { setPage(page - 1); setSelectedId(null); setReason(''); setLoading(true); }}>{t('previous')}</Button>
                  <Button variant="outline" disabled={saving || page >= pages} onClick={() => { setPage(page + 1); setSelectedId(null); setReason(''); setLoading(true); }}>{t('next')}</Button>
                </div>
              </nav>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
