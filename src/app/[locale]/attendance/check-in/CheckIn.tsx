'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { fetchEmployeeSchedule, employeeScheduleErrorKind } from '@/frontend/features/employee-schedule/employeeScheduleApi';
import { AttendanceApiError, attendanceActions, recordAttendance } from '@/frontend/features/employee-attendance/employeeAttendanceApi';
import type { EmployeeSchedulePage } from '@/shared/employee-schedule';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';

export default function CheckIn({ initialDate }: { initialDate: string }) {
  const t = useTranslations('employeeAttendance');
  const s = useTranslations('employeeSchedule');
  const locale = useLocale();
  const [date, setDate] = useState(initialDate);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<EmployeeSchedulePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const actionLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setLoadError(null);
    fetchEmployeeSchedule(date, date, page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (page > 1 && page > result.pagination.totalPages) {
        setPage(Math.max(1, result.pagination.totalPages));
        return;
      }
      setData(result);
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(employeeScheduleErrorKind(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [date, page, reload]);

  async function act(id: string, action: 'check-in' | 'check-out') {
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(true);
    setNotice(null);
    try {
      await recordAttendance(id, action);
      setNotice({ error: false, key: action === 'check-in' ? 'checkInSuccess' : 'checkOutSuccess' });
    } catch (error) {
      const status = error instanceof AttendanceApiError ? error.status : undefined;
      setNotice({ error: true, key: status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 400 ? 'invalidAction' : 'actionError' });
    } finally {
      // Reconcile conflicts and lost responses too: the server may have saved the action.
      setData(null);
      setLoading(true);
      setReload(value => value + 1);
      setPending(false);
      actionLock.current = false;
    }
  }

  function changeDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setData(null);
    setLoading(true);
    setNotice(null);
    setPage(1);
    setDate(value);
    setReload(value => value + 1);
  }
  const format = (value: string, timeZone: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone, calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));

  return (
    <main className="container mx-auto max-w-3xl space-y-6 py-8">
      <header><h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p></header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1"><span className="block text-sm font-medium">{t('date')}</span>
          <input type="date" value={date} disabled={pending} onChange={event => changeDate(event.target.value)}
            className="rounded-md border bg-background p-2" /></label>
        <Button variant="outline" disabled={pending} onClick={() => changeDate(dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE))}>{s('today')}</Button>
        <Button variant="outline" disabled={pending || loading} onClick={() => { setLoading(true); setReload(value => value + 1); }}>{t('refresh')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{s('timeZone', { zone: DEFAULT_WORKSITE_TIME_ZONE })}</p>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'text-destructive' : 'text-green-700 dark:text-green-400'}>{t(notice.key)}</p>}
      {loading && <p role="status">{s('loading')}</p>}
      {!loading && loadError && <div className="space-y-3"><p role="alert">{s(loadError)}</p>
        <Button onClick={() => setReload(value => value + 1)}>{s('retry')}</Button></div>}
      {!loading && data?.assignments.length === 0 && <p role="status">{t('empty')}</p>}
      {!loading && data?.assignments.map(item => {
        const actions = attendanceActions(item);
        return <Card key={item.id}>
          <CardHeader><CardTitle className="break-words"><bdi>{item.shift.title}</bdi></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="break-words"><bdi>{item.shift.location}</bdi></p>
            <p>{s('start')}: <time dateTime={item.shift.startAt}><bdi>{format(item.shift.startAt, item.shift.timeZone)}</bdi></time></p>
            <p>{s('end')}: <time dateTime={item.shift.endAt}><bdi>{format(item.shift.endAt, item.shift.timeZone)}</bdi></time></p>
            <p>{s('assignmentStatus')}: {s(`assignmentStatuses.${item.status}`)}</p>
            <p>{s('shiftStatus')}: {s(`shiftStatuses.${item.shift.status}`)}</p>
            <p>{item.attendance ? `${s('attendance')}: ${s(`attendanceStatuses.${item.attendance.attendanceStatus}`)}` : s('noAttendance')}</p>
            {item.attendance?.checkInAt && <p>{s('checkedIn')}: <time dateTime={item.attendance.checkInAt}><bdi>{format(item.attendance.checkInAt, item.shift.timeZone)}</bdi></time></p>}
            {item.attendance?.checkOutAt && <p>{s('checkedOut')}: <time dateTime={item.attendance.checkOutAt}><bdi>{format(item.attendance.checkOutAt, item.shift.timeZone)}</bdi></time></p>}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button disabled={pending || !actions.checkIn} onClick={() => act(item.id, 'check-in')}>{t('checkIn')}</Button>
              <Button variant="outline" disabled={pending || !actions.checkOut} onClick={() => act(item.id, 'check-out')}>{t('checkOut')}</Button>
            </div>
          </CardContent>
        </Card>;
      })}
      {!loading && data && data.pagination.totalPages > 1 && <nav aria-label={s('pagination')} className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={pending || page === 1} onClick={() => { setLoading(true); setPage(value => value - 1); }}>{s('previous')}</Button>
        <p>{s('page', { page, pages: data.pagination.totalPages, total: data.pagination.total })}</p>
        <Button variant="outline" disabled={pending || page >= data.pagination.totalPages} onClick={() => { setLoading(true); setPage(value => value + 1); }}>{s('next')}</Button>
      </nav>}
    </main>
  );
}
