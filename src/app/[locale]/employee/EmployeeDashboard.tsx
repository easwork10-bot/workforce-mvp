'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { employeeScheduleErrorKind, type EmployeeScheduleErrorKind } from '@/frontend/features/employee-schedule/employeeScheduleApi';
import { fetchUpcomingSchedule } from '@/frontend/features/employee-schedule/upcomingSchedule';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';
import { Link as LocaleLink } from '@/shared/i18n-routing';
import { Calendar, Clock, CheckCircle, AlertCircle, Users, Plus } from 'lucide-react';
import { fetchEmployeeDashboard } from '@/frontend/features/employee-dashboard/employeeDashboardApi';
import type { EmployeeDashboardSummary } from '@/shared/employee-dashboard';

export default function EmployeeDashboard() {
  const tEmployee = useTranslations('employee');
  const tSchedule = useTranslations('employeeSchedule');
  const t = useTranslations('employeeDashboard');
  const locale = useLocale();
  const [summary, setSummary] = useState<EmployeeDashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<EmployeeScheduleErrorKind | null>(null);
  const [reloadSummary, setReloadSummary] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setSummaryError(null);
    fetchEmployeeDashboard(controller.signal)
      .then(result => { if (!controller.signal.aborted) setSummary(result); })
      .catch(error => { if (!controller.signal.aborted) setSummaryError(employeeScheduleErrorKind(error)); });
    return () => controller.abort();
  }, [reloadSummary]);
  const [upcoming, setUpcoming] = useState<EmployeeScheduleItem[] | null>(null);
  const [scheduleError, setScheduleError] = useState<EmployeeScheduleErrorKind | null>(null);
  const [reloadSchedule, setReloadSchedule] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setUpcoming(null);
    setScheduleError(null);
    fetchUpcomingSchedule(new Date(), controller.signal)
      .then(items => { if (!controller.signal.aborted) setUpcoming(items); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setScheduleError(employeeScheduleErrorKind(error));
      });
    return () => controller.abort();
  }, [reloadSchedule]);

  const formatInstant = (value: string, timeZone: string) => new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar' : 'nl-NL',
    { timeZone, calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date(value));

  return (
    <main className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tEmployee('dashboard')}</h1>
          <p className="text-muted-foreground mt-2">
            {t('welcome')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tSchedule('upcomingTitle')}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {upcoming ? (
              <div role="status" className="text-2xl font-bold" aria-label={tSchedule('upcomingCount', { count: upcoming.length })}>
                {upcoming.length}
              </div>
            ) : <div className="text-2xl font-bold" aria-hidden="true">—</div>}
            <p className="text-xs text-muted-foreground">
              {scheduleError ? tSchedule(scheduleError) : tSchedule('thisWeek')}
            </p>
          </CardContent>
        </Card>

        {([
          ['pending', 'pendingDescription', summary?.pendingApplications, Clock],
          ['accepted', 'acceptedDescription', summary?.acceptedThisMonth, CheckCircle],
          ['hours', 'hoursDescription', summary?.workedHoursThisMonth, Users],
        ] as const).map(([title, description, value, Icon]) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t(title)}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid={'dashboard-' + title}>
                {value === undefined ? '—' : new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
                  maximumFractionDigits: title === 'hours' ? 2 : 0,
                }).format(value)}
              </div>
              <p className="text-xs text-muted-foreground">{t(description)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Upcoming Shifts */}
        <Card className="col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{tSchedule('upcomingTitle')}</CardTitle>
                <CardDescription>{tSchedule('upcomingDescription')}</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <LocaleLink href="/employee/schedule">{tSchedule('viewAll')}</LocaleLink>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!upcoming && !scheduleError && <p role="status" className="text-muted-foreground">{tSchedule('loading')}</p>}
            {scheduleError && (
              <div className="space-y-3">
                <p role="alert" className="text-destructive">{tSchedule(scheduleError)}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setReloadSchedule(value => value + 1)}>
                  {tSchedule('retry')}
                </Button>
              </div>
            )}
            {upcoming && upcoming.length === 0 && <p className="text-muted-foreground">{tSchedule('emptyUpcoming')}</p>}
            {upcoming && upcoming.length > 0 && (
              <ul className="space-y-4" aria-label={tSchedule('upcomingTitle')}>
                {upcoming.slice(0, 2).map(assignment => (
                  <li key={assignment.id} className="flex min-w-0 flex-col gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50 sm:flex-row sm:justify-between">
                    <div className="min-w-0 break-words">
                      <p className="font-medium"><bdi>{assignment.shift.title}</bdi></p>
                      <p className="text-sm text-muted-foreground">
                        <time dateTime={assignment.shift.startAt}>
                          <bdi>{formatInstant(assignment.shift.startAt, assignment.shift.timeZone)}</bdi>
                        </time>
                        {' – '}
                        <time dateTime={assignment.shift.endAt}>
                          <bdi>{formatInstant(assignment.shift.endAt, assignment.shift.timeZone)}</bdi>
                        </time>
                      </p>
                      <p className="text-sm text-muted-foreground"><bdi>{assignment.shift.location}</bdi></p>
                    </div>
                    <span className="inline-flex h-fit w-fit shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                      {tSchedule(`assignmentStatuses.${assignment.status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Applications */}
        <Card className="col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t('recentApplications')}</CardTitle>
                <CardDescription>{t('applicationsDescription')}</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm"><LocaleLink href="/employee/applications">{tSchedule('viewAll')}</LocaleLink></Button>
            </div>
          </CardHeader>
          <CardContent>
            {!summary && !summaryError && <p role="status">{tSchedule('loading')}</p>}
            {summaryError && <div className="space-y-3">
              <p role="alert" className="text-destructive">{tSchedule(summaryError)}</p>
              <Button variant="outline" onClick={() => setReloadSummary(value => value + 1)}>{tSchedule('retry')}</Button>
            </div>}
            {summary && summary.recentApplications.length === 0 && <p>{t('emptyApplications')}</p>}
            {summary && <ul className="space-y-4" aria-label={t('recentApplications')}>
              {summary.recentApplications.map(application => (
                <li key={application.id} className="flex min-w-0 flex-col gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50 sm:flex-row sm:justify-between">
                  <div className="min-w-0 break-words">
                    <p className="font-medium"><bdi>{application.shift.title}</bdi></p>
                    <p className="text-sm text-muted-foreground"><time dateTime={application.shift.startAt}>
                      <bdi>{formatInstant(application.shift.startAt, summary.timeZone)}</bdi>
                    </time></p>
                    <p className="text-sm text-muted-foreground"><bdi>{application.shift.location}</bdi></p>
                  </div>
                  <span className={`inline-flex h-fit w-fit shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    application.status === 'pending'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : application.status === 'accepted'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-muted'
                  }`}>
                    {application.status === 'pending' && <Clock className="h-3 w-3 me-1" aria-hidden="true" />}
                    {application.status === 'accepted' && <CheckCircle className="h-3 w-3 me-1" aria-hidden="true" />}
                    {t('statuses.' + application.status)}
                  </span>
                </li>
              ))}
            </ul>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LocaleLink href="/employee/shifts">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
                <Plus className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg">{t('browse')}</CardTitle>
              <CardDescription>{t('browseDescription')}</CardDescription>
            </CardContent>
          </Card>
        </LocaleLink>

        <LocaleLink href="/employee/schedule">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <Calendar className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-lg">{t('schedule')}</CardTitle>
              <CardDescription>{t('scheduleDescription')}</CardDescription>
            </CardContent>
          </Card>
        </LocaleLink>

        <LocaleLink href="/employee/applications">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center mb-4">
                <Clock className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
              </div>
              <CardTitle className="text-lg">{t('applications')}</CardTitle>
              <CardDescription>{t('trackApplications')}</CardDescription>
            </CardContent>
          </Card>
        </LocaleLink>

        <LocaleLink href="/attendance/check-in">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-4">
                <AlertCircle className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-lg">{t('attendance')}</CardTitle>
              <CardDescription>{t('attendanceDescription')}</CardDescription>
            </CardContent>
          </Card>
        </LocaleLink>
      </div>
    </main>
  );
}
