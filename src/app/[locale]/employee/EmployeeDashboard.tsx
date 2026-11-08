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
import Link from 'next/link';

const mockApplications = [
  {
    id: '1',
    shiftTitle: 'Logistics Support - Utrecht',
    date: '2024-01-17',
    status: 'pending',
  },
  {
    id: '2',
    shiftTitle: 'Event Staff - The Hague',
    date: '2024-01-20',
    status: 'accepted',
  },
];

export default function EmployeeDashboard() {
  const tEmployee = useTranslations('employee');
  const tSchedule = useTranslations('employeeSchedule');
  const locale = useLocale();
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
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tEmployee('dashboard')}</h1>
          <p className="text-muted-foreground mt-2">
            Welcome back! HereHereHere'sapos;sapos;s your schedule and applications overview
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Applications</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1</div>
            <p className="text-xs text-muted-foreground">Waiting for approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accepted</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hours This Month</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">84</div>
            <p className="text-xs text-muted-foreground">Total worked</p>
          </CardContent>
        </Card>
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
                <CardTitle>Recent Applications</CardTitle>
                <CardDescription>Status of your shift applications</CardDescription>
              </div>
              <Link href="/employee/applications">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockApplications.map((app) => (
                <div key={app.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div>
                    <p className="font-medium">{app.shiftTitle}</p>
                    <p className="text-sm text-muted-foreground">{app.date}</p>
                  </div>
                  {app.status === 'pending' ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      <Clock className="h-3 w-3 mr-1" />
                      Pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Accepted
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/employee/shifts">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-4">
                <Plus className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              </div>
              <CardTitle className="text-lg">Browse Shifts</CardTitle>
              <CardDescription>Find and apply for available shifts</CardDescription>
            </CardContent>
          </Card>
        </Link>

        <LocaleLink href="/employee/schedule">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <Calendar className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-lg">My Schedule</CardTitle>
              <CardDescription>View your weekly/monthly calendar</CardDescription>
            </CardContent>
          </Card>
        </LocaleLink>

        <Link href="/employee/applications">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-yellow-100 dark:bg-yellow-900 flex items-center justify-center mb-4">
                <Clock className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
              </div>
              <CardTitle className="text-lg">My Applications</CardTitle>
              <CardDescription>Track your shift applications</CardDescription>
            </CardContent>
          </Card>
        </Link>

        <Link href="/attendance/check-in">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-4">
                <AlertCircle className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
              <CardTitle className="text-lg">Check In/Out</CardTitle>
              <CardDescription>Record your attendance</CardDescription>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}