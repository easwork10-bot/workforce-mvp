"use client";

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import EmployeeApplicationsList from '@/frontend/features/employee-applications/EmployeeApplicationsList';
import { Button } from '@/frontend/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';

export default function EmployeeDashboard() {
  const tEmployee = useTranslations('employee');
  const tApplications = useTranslations('employeeApplications');

  return (
    <main className="container mx-auto space-y-6 py-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{tEmployee('dashboard')}</h1>
        <p className="mt-2 text-muted-foreground">{tApplications('dashboard.description')}</p>
      </header>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{tApplications('dashboard.recentTitle')}</CardTitle>
            <CardDescription className="mt-1">{tApplications('dashboard.recentDescription')}</CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/employee/applications">{tApplications('dashboard.viewAll')}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <EmployeeApplicationsList limit={3} compact />
        </CardContent>
      </Card>

      <Button asChild>
        <Link href="/employee/shifts">{tApplications('browseShifts')}</Link>
      </Button>
    </main>
  );
}
