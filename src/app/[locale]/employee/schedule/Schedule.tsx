'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Clock, MapPin, Sun } from 'lucide-react';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardHeader } from '@/frontend/ui/card';
import {
  employeeScheduleErrorKind, fetchEmployeeSchedule, type EmployeeScheduleErrorKind,
} from '@/frontend/features/employee-schedule/employeeScheduleApi';
import {
  groupAssignmentsByDay, moveScheduleAnchor, scheduleRange, type ScheduleView,
} from '@/frontend/features/employee-schedule/scheduleCalendar';
import type { EmployeeScheduleItem, EmployeeSchedulePage } from '@/shared/employee-schedule';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';
import { Link } from '@/shared/i18n-routing';

type LoadState =
  | { key: string; kind: 'loading' }
  | { key: string; kind: 'error'; error: EmployeeScheduleErrorKind }
  | { key: string; kind: 'loaded'; data: EmployeeSchedulePage };

function assignmentColor(status: EmployeeScheduleItem['status']): string {
  if (status === 'confirmed') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (status === 'assigned') return 'bg-orange-100 text-orange-900 dark:bg-orange-900 dark:text-orange-100';
  return 'bg-muted text-muted-foreground';
}

export default function EmployeeSchedule({ initialDate }: { initialDate: string }) {
  const t = useTranslations('employeeSchedule');
  const locale = useLocale();
  const language = locale === 'ar' ? 'ar' : 'nl-NL';
  const [anchor, setAnchor] = useState(initialDate);
  const [today, setToday] = useState(initialDate);
  const [view, setView] = useState<ScheduleView>('week');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LoadState>({ key: '', kind: 'loading' });
  const range = scheduleRange(anchor, view);
  const queryKey = `${range.from}:${range.to}:${page}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    setMounted(true);
    setState({ key: queryKey, kind: 'loading' });
    fetchEmployeeSchedule(range.from, range.to, page, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        if (page > 1 && page > data.pagination.totalPages) {
          setPage(Math.max(1, data.pagination.totalPages));
          return;
        }
        setState({ key: queryKey, kind: 'loaded', data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ key: queryKey, kind: 'error', error: employeeScheduleErrorKind(error) });
        }
      });
    return () => controller.abort();
  }, [page, queryKey, range.from, range.to]);

  const loading = state.key !== queryKey || state.kind === 'loading';
  const data = state.key === queryKey && state.kind === 'loaded' ? state.data : null;
  const error = state.key === queryKey && state.kind === 'error' ? state.error : null;
  const groups = groupAssignmentsByDay(range.days, data?.assignments ?? []);
  const visibleGroups = view === 'week' ? groups : groups.filter(group => group.assignments.length > 0);
  const dayFormat = new Intl.DateTimeFormat(language, {
    timeZone: 'UTC', calendar: 'gregory', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const shortDate = new Intl.DateTimeFormat(language, {
    timeZone: 'UTC', calendar: 'gregory', day: 'numeric', month: 'short', year: 'numeric',
  });
  const monthFormat = new Intl.DateTimeFormat(language, {
    timeZone: 'UTC', calendar: 'gregory', month: 'long', year: 'numeric',
  });
  const calendarDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
  const rangeLabel = view === 'week'
    ? `${shortDate.format(calendarDate(range.from))} – ${shortDate.format(calendarDate(range.to))}`
    : monthFormat.format(calendarDate(range.from));
  const formatInstant = (value: string, timeZone: string) => new Intl.DateTimeFormat(language, {
    timeZone, calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));

  function changeView(next: ScheduleView) {
    setPage(1);
    setView(next);
  }

  function move(direction: -1 | 1) {
    setPage(1);
    setAnchor(current => moveScheduleAnchor(current, view, direction));
  }

  function goToToday() {
    const current = dateKeyInTimeZone(new Date(), DEFAULT_WORKSITE_TIME_ZONE);
    setPage(1);
    setToday(current);
    setAnchor(current);
  }

  return (
    <main className="container mx-auto space-y-6 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </header>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
              <Button type="button" variant="outline" size="sm" onClick={() => move(-1)}
                aria-label={t(view === 'week' ? 'previousWeek' : 'previousMonth')}>
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Button>
              <span className="min-w-0 text-center text-sm font-medium sm:text-lg" aria-live="polite">
                {mounted && <bdi>{rangeLabel}</bdi>}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => move(1)}
                aria-label={t(view === 'week' ? 'nextWeek' : 'nextMonth')}>
                <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={goToToday}>
                <Sun className="me-2 h-4 w-4" aria-hidden="true" />{t('today')}
              </Button>
              <div className="flex overflow-hidden rounded-md border">
                <Button type="button" variant={view === 'week' ? 'default' : 'ghost'} size="sm"
                  aria-pressed={view === 'week'} onClick={() => changeView('week')} className="rounded-none">
                  {t('week')}
                </Button>
                <Button type="button" variant={view === 'month' ? 'default' : 'ghost'} size="sm"
                  aria-pressed={view === 'month'} onClick={() => changeView('month')} className="rounded-none">
                  {t('month')}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && <p role="status" className="py-8 text-center text-muted-foreground">{t('loading')}</p>}
      {!loading && error && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <p role="alert" className="text-destructive">{t(error)}</p>
            <Button type="button" variant="outline" onClick={() => setReload(value => value + 1)}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}
      {!loading && data && data.assignments.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <p role="status" className="text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      )}
      {!loading && data && data.assignments.length > 0 && (
        <>
          {view === 'month' && <p className="text-sm text-muted-foreground">{t('monthDescription')}</p>}
          <div className="grid gap-4">
            {visibleGroups.map(group => (
              <section key={group.date} aria-labelledby={`schedule-day-${group.date}`}>
                <Card className={group.date === today ? 'ring-2 ring-blue-500' : ''}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 id={`schedule-day-${group.date}`} className="font-semibold">
                          {dayFormat.format(calendarDate(group.date))}
                        </h2>
                        {group.date === today && <span className="text-sm text-blue-600 dark:text-blue-400">{t('today')}</span>}
                      </div>
                      <span className="text-sm text-muted-foreground">{t('shiftCount', { count: group.assignments.length })}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {group.assignments.length === 0 ? (
                      <p className="py-4 text-center text-muted-foreground">{t('emptyDay')}</p>
                    ) : (
                      <ul className="space-y-3" aria-label={t('list')}>
                        {group.assignments.map(assignment => (
                          <li key={assignment.id} className="flex min-w-0 flex-col gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50 sm:flex-row sm:justify-between">
                            <div className="min-w-0 space-y-1 break-words">
                              <h3 className="font-medium"><bdi>{assignment.shift.title}</bdi></h3>
                              <p className="flex items-start gap-1 text-sm text-muted-foreground">
                                <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>
                                  {t('start')}: <time dateTime={assignment.shift.startAt}>
                                    <bdi>{formatInstant(assignment.shift.startAt, assignment.shift.timeZone)}</bdi>
                                  </time>
                                  {' · '}{t('end')}: <time dateTime={assignment.shift.endAt}>
                                    <bdi>{formatInstant(assignment.shift.endAt, assignment.shift.timeZone)}</bdi>
                                  </time>
                                </span>
                              </p>
                              <p className="flex items-start gap-1 text-sm text-muted-foreground">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <bdi>{assignment.shift.location}</bdi>
                              </p>
                              <p className="text-sm text-muted-foreground">{t('timeZone', { zone: assignment.shift.timeZone })}</p>
                              <p className="text-sm">{t('shiftStatus')}: {t(`shiftStatuses.${assignment.shift.status}`)}</p>
                              <Link className="inline-block text-sm underline" href={`/attendance/check-in?date=${group.date}`}>
                                {t('attendance')}
                              </Link>
                              {assignment.attendance ? (
                                <div className="space-y-1 text-sm">
                                  <p>{t('attendance')}: {t(`attendanceStatuses.${assignment.attendance.attendanceStatus}`)}</p>
                                  {assignment.attendance.checkInAt && (
                                    <p>{t('checkedIn')}: <time dateTime={assignment.attendance.checkInAt}>
                                      <bdi>{formatInstant(assignment.attendance.checkInAt, assignment.shift.timeZone)}</bdi>
                                    </time></p>
                                  )}
                                  {assignment.attendance.checkOutAt && (
                                    <p>{t('checkedOut')}: <time dateTime={assignment.attendance.checkOutAt}>
                                      <bdi>{formatInstant(assignment.attendance.checkOutAt, assignment.shift.timeZone)}</bdi>
                                    </time></p>
                                  )}
                                </div>
                              ) : <p className="text-sm text-muted-foreground">{t('noAttendance')}</p>}
                            </div>
                            <span className={`inline-flex h-fit w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${assignmentColor(assignment.status)}`}>
                              {t('assignmentStatus')}: {t(`assignmentStatuses.${assignment.status}`)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </section>
            ))}
          </div>
          {data.pagination.totalPages > 1 && (
            <nav aria-label={t('pagination')} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p role="status">{t('page', {
                page: data.pagination.page, pages: data.pagination.totalPages, total: data.pagination.total,
              })}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>
                  {t('previous')}
                </Button>
                <Button type="button" variant="outline" disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(value => value + 1)}>{t('next')}</Button>
              </div>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
