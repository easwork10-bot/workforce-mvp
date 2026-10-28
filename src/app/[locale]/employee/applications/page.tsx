import Link from 'next/link';
import { useTranslations } from 'next-intl';
import EmployeeApplicationsList from '@/frontend/features/employee-applications/EmployeeApplicationsList';
import { Button } from '@/frontend/ui/button';

export default function EmployeeApplicationsPage() {
  const t = useTranslations('employeeApplications');

  return (
    <main className="container mx-auto space-y-6 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/employee/shifts">{t('browseShifts')}</Link>
        </Button>
      </header>
      <EmployeeApplicationsList />
    </main>
  );
}
