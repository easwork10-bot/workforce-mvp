"use client";

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/shared/i18n-routing';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import {
  AdminShiftApiError,
  fetchAdminShifts,
  type AdminShiftPage,
} from '@/frontend/features/admin-shifts/adminShiftsApi';
import { Calendar, Plus, Search } from 'lucide-react';

export default function AdminDashboard() {
  const tAdmin = useTranslations('admin');
  const tShifts = useTranslations('shifts');
  const tManagement = useTranslations('adminShiftManagement');
  const locale = useLocale();
  const [data, setData] = useState<AdminShiftPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAdminShifts({
      page: 1,
      limit: 5,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }, controller.signal).then(setData).catch((requestError: unknown) => {
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(requestError instanceof AdminShiftApiError
        ? requestError.message
        : tManagement('loadError'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tManagement]);

  const dateFormatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
    timeZone: 'Europe/Amsterdam',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const stats = data?.stats;
  const cards = [
    { label: tManagement('totalShifts'), value: stats?.total },
    { label: tShifts('status.draft'), value: stats?.draft },
    { label: tShifts('status.open'), value: stats?.open },
    { label: tShifts('status.filled'), value: stats?.filled },
  ];

  return (
    <div className="container mx-auto space-y-8 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{tAdmin('dashboard')}</h1>
        <p className="mt-2 text-muted-foreground">{tManagement('dashboardDescription')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((item) => (
          <Card key={item.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{item.label}</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? '—' : error ? '—' : item.value ?? 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>{tShifts('list')}</CardTitle>
            <CardDescription>{tManagement('dashboardDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading && <p className="py-4 text-muted-foreground" role="status">{tManagement('loading')}</p>}
            {!loading && error && <p className="py-4 text-red-700 dark:text-red-300" role="alert">{error}</p>}
            {!loading && !error && data?.shifts.length === 0 && (
              <p className="py-4 text-muted-foreground">{tManagement('empty')}</p>
            )}
            {!loading && !error && data && data.shifts.length > 0 && (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {data.shifts.map((shift) => (
                  <li key={shift.id} className="flex flex-col gap-1 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{shift.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {dateFormatter.format(new Date(shift.startAt))}
                        {' · '}{shift.assignedCount} / {shift.requiredWorkers} {tManagement('workers')}
                      </p>
                    </div>
                    <span className="text-sm font-medium">{tShifts(`status.${shift.status}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{tManagement('actions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link href="/admin/shifts/create">
              <Button className="w-full justify-start gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {tShifts('create')}
              </Button>
            </Link>
            <Link href="/admin/shifts">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Search className="h-4 w-4" aria-hidden="true" />
                {tShifts('list')}
              </Button>
            </Link>
            <Link href="/admin/applications">
              <Button className="w-full justify-start gap-2" variant="outline">
                {tAdmin('applications')}
              </Button>
            </Link>
            <Button asChild className="w-full justify-start gap-2" variant="outline">
              <Link href="/admin/assignments">{tAdmin('assignments')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
