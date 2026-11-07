'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardHeader } from '@/frontend/ui/card';
import { assignmentStatuses, type AdminAssignment, type AdminAssignmentPage, type AssignmentStatus } from '@/shared/admin-assignments';
import { AdminAssignmentApiError, cancelAdminAssignment, fetchAdminAssignments } from './adminAssignmentsApi';

const cancellationCodes = [
  'ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_STATE_CONFLICT', 'SHIFT_STARTED',
  'ATTENDANCE_EXISTS', 'INVALID_REQUEST', 'INTERNAL_ERROR',
] as const;

export function AdminAssignmentListView({
  data, loading, error, status, onStatusChange, onPageChange, onRefresh,
  selected, saving, feedback, onSelect, onDismiss, onConfirm,
}: {
  data: AdminAssignmentPage | null;
  loading: boolean;
  error: string | null;
  status: AssignmentStatus | '';
  onStatusChange: (status: AssignmentStatus | '') => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  selected: AdminAssignment | null;
  saving: boolean;
  feedback: { error: boolean; message: string } | null;
  onSelect: (assignment: AdminAssignment) => void;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('adminAssignmentManagement');
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short',
  });

  return (
    <main className="container mx-auto space-y-5 py-8">
      <header>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </header>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={`rounded-md border p-3 text-sm ${feedback.error
        ? 'border-red-200 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
        : 'border-green-200 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'}`}>
        {feedback.message}
      </p>}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="assignment-status" className="text-sm font-medium">{t('filter')}</label>
            <select id="assignment-status" className="input min-h-10 max-w-full" value={status} disabled={saving}
              onChange={event => onStatusChange(assignmentStatuses.find(value => value === event.target.value) ?? '')}>
              <option value="">{t('all')}</option>
              {assignmentStatuses.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </div>
          <Button type="button" variant="outline" disabled={loading || saving} onClick={onRefresh}>{t('refresh')}</Button>
        </CardHeader>
        <CardContent aria-busy={loading || saving}>
          {loading && <p role="status" className="py-6 text-muted-foreground">{t('loading')}</p>}
          {!loading && error && (
            <div className="space-y-3 py-6">
              <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>
              <Button type="button" variant="outline" disabled={saving} onClick={onRefresh}>{t('retry')}</Button>
            </div>
          )}
          {!loading && !error && data && (
            <>
              {data.assignments.length === 0 && <p role="status" className="py-6 text-muted-foreground">{t('empty')}</p>}
              <ul className="divide-y divide-border" aria-label={t('list')}>
                {data.assignments.map(assignment => (
                  <li key={assignment.id} className="grid min-w-0 gap-3 py-4 first:pt-0 sm:grid-cols-2 lg:grid-cols-[1fr_1.5fr_1fr]">
                    <div className="min-w-0 space-y-1 break-words">
                      <h2 className="font-semibold"><bdi>{assignment.employee.fullName}</bdi></h2>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${assignment.status === 'assigned'
                        ? 'bg-orange-100 text-orange-900' : 'bg-muted text-foreground'}`}>
                        {t(`status.${assignment.status}`)}
                      </span>
                    </div>
                    <div className="min-w-0 space-y-1 break-words text-sm">
                      <h3 className="font-medium"><bdi>{assignment.shift.title}</bdi></h3>
                      <p className="text-muted-foreground"><bdi>{assignment.shift.location}</bdi></p>
                      <p>{t('start')} <time dateTime={assignment.shift.startAt}>{date.format(new Date(assignment.shift.startAt))}</time></p>
                      <p>{t('end')} <time dateTime={assignment.shift.endAt}>{date.format(new Date(assignment.shift.endAt))}</time></p>
                    </div>
                    <div className="min-w-0 space-y-3 break-words text-sm">
                      <p className="text-muted-foreground">
                        {t('assignedAt')} <time dateTime={assignment.assignedAt}>{date.format(new Date(assignment.assignedAt))}</time>
                      </p>
                      {(assignment.status === 'assigned' || assignment.status === 'confirmed') && (
                        <Button type="button" variant="outline" disabled={saving}
                          onClick={event => { trigger.current = event.currentTarget; onSelect(assignment); }}>
                          {t('cancel')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <nav aria-label={t('pagination')} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
                <p role="status">{t('page', {
                  page: data.pagination.page, pages: Math.max(1, data.pagination.totalPages), total: data.pagination.total,
                })}</p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" disabled={saving || data.pagination.page <= 1}
                    onClick={() => onPageChange(data.pagination.page - 1)}>{t('previous')}</Button>
                  <Button type="button" variant="outline" disabled={saving || data.pagination.page >= data.pagination.totalPages}
                    onClick={() => onPageChange(data.pagination.page + 1)}>{t('next')}</Button>
                </div>
              </nav>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog.Root open={selected !== null} onOpenChange={open => { if (!open && !saving) onDismiss(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content dir={locale === 'ar' ? 'rtl' : 'ltr'}
            className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border bg-background p-6 text-start shadow-lg"
            onOpenAutoFocus={event => { event.preventDefault(); dismiss.current?.focus(); }}
            onCloseAutoFocus={event => {
              event.preventDefault();
              if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
              else heading.current?.focus();
            }}
            onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}
            onInteractOutside={event => { if (saving) event.preventDefault(); }}>
            <Dialog.Title className="text-lg font-semibold">{t('cancelTitle')}</Dialog.Title>
            <Dialog.Description className="space-y-2 text-sm text-muted-foreground" asChild>
              <div>
                <p>{t('cancelFor', { name: selected?.employee.fullName ?? '', shift: selected?.shift.title ?? '' })}</p>
                <p>{t('cancelRules')}</p>
              </div>
            </Dialog.Description>
            <div className="flex flex-wrap justify-end gap-2" aria-busy={saving}>
              <Button ref={dismiss} type="button" variant="outline" disabled={saving} onClick={onDismiss}>{t('keep')}</Button>
              <Button type="button" disabled={saving} onClick={onConfirm}>{saving ? t('cancelling') : t('confirmCancel')}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}

export default function AdminAssignmentList() {
  const t = useTranslations('adminAssignmentManagement');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AssignmentStatus | ''>('');
  const [data, setData] = useState<AdminAssignmentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<AdminAssignment | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const submitting = useRef(false);
  const errorMessage = useCallback((failure: unknown, fallback: 'loadError' | 'cancelError' = 'loadError') => {
    if (failure instanceof AdminAssignmentApiError) {
      if (failure.status === 401) return t('unauthorized');
      if (failure.status === 403) return t('forbidden');
      if (failure.status === 503) return t('unavailable');
      if (fallback === 'cancelError') {
        const code = cancellationCodes.find(value => value === failure.code);
        if (code) return t(`errors.${code}`);
      }
    }
    return t(fallback);
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    let correctingPage = false;
    setLoading(true);
    setError(null);
    void fetchAdminAssignments(page, status || undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, result.pagination.totalPages);
      if (page > lastPage) {
        correctingPage = true;
        setPage(lastPage);
        return;
      }
      setData(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted && !correctingPage) {
        setLoading(false);
        setSaving(false);
        submitting.current = false;
      }
    });
    return () => controller.abort();
  }, [page, status, reload, errorMessage]);

  const clear = () => {
    setData(null);
    setError(null);
    setLoading(true);
  };

  const cancel = async () => {
    if (!selected || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await cancelAdminAssignment(selected.id);
      setFeedback({ error: false, message: t(result.replayed ? 'cancelReplayed' : 'cancelled') });
    } catch (failure) {
      setFeedback({ error: true, message: errorMessage(failure, 'cancelError') });
    } finally {
      setSelected(null);
      clear();
      setReload(value => value + 1);
    }
  };

  return <AdminAssignmentListView data={data} loading={loading} error={error} status={status}
    selected={selected} saving={saving} feedback={feedback}
    onSelect={assignment => { if (!submitting.current) { setFeedback(null); setSelected(assignment); } }}
    onDismiss={() => { if (!submitting.current) setSelected(null); }}
    onConfirm={() => void cancel()}
    onStatusChange={value => { if (!submitting.current) { clear(); setFeedback(null); setStatus(value); setPage(1); } }}
    onPageChange={value => { if (!submitting.current) { clear(); setFeedback(null); setPage(value); } }}
    onRefresh={() => { if (!submitting.current) { clear(); setReload(value => value + 1); } }} />;
}
