"use client";

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { Calendar, MapPin, Clock, Plus, MoreHorizontal } from 'lucide-react';
import { Link } from '@/shared/i18n-routing';

const mockShifts = [
  {
    id: '1',
    title: 'Traffic Controller - Amsterdam',
    workType: 'Traffic Control',
    client: 'City of Amsterdam',
    location: 'Amsterdam Central Station',
    date: '2024-01-15',
    startTime: '08:00',
    endTime: '16:00',
    requiredWorkers: 2,
    assignedWorkers: 2,
    status: 'active',
    compensation: '€18.50/hour',
  },
  {
    id: '2',
    title: 'Cleaning Service - Rotterdam',
    workType: 'Cleaning',
    client: 'Office Complex Rotterdam',
    location: 'Rotterdam Business Park',
    date: '2024-01-16',
    startTime: '17:00',
    endTime: '22:00',
    requiredWorkers: 5,
    assignedWorkers: 3,
    status: 'open',
    compensation: '€15.00/hour',
  },
  {
    id: '3',
    title: 'Logistics Support - Utrecht',
    workType: 'Logistics',
    client: 'Warehouse Utrecht',
    location: 'Utrecht Distribution Center',
    date: '2024-01-17',
    startTime: '06:00',
    endTime: '14:00',
    requiredWorkers: 3,
    assignedWorkers: 1,
    status: 'open',
    compensation: '€16.50/hour',
  },
  {
    id: '4',
    title: 'Event Staff - The Hague',
    workType: 'Event Support',
    client: 'Conference Center',
    location: 'The Hague Convention Center',
    date: '2024-01-20',
    startTime: '09:00',
    endTime: '18:00',
    requiredWorkers: 10,
    assignedWorkers: 0,
    status: 'draft',
    compensation: '€20.00/hour',
  },
];

export default function AdminShiftsPage() {
  const tShifts = useTranslations('shifts');
  const tCommon = useTranslations('common');

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      filled: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      completed: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    };
    return styles[status as keyof typeof styles] || styles.draft;
  };

  const getStatusLabel = (status: string) => {
    const labels = {
      draft: tShifts('status.draft'),
      open: tShifts('status.open'),
      active: tShifts('status.active'),
      filled: tShifts('status.filled'),
      cancelled: tShifts('status.cancelled'),
      completed: tShifts('status.completed'),
    };
    return labels[status as keyof typeof labels] || status;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tShifts('list')}</h1>
          <p className="text-muted-foreground mt-1">Manage and oversee all shifts</p>
        </div>
        <Link href="/admin/shifts/create">
          <Button className="w-full sm:w-auto gap-2">
            <Plus className="h-4 w-4" />
            {tShifts('create')}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tShifts('list')}</CardTitle>
          <CardDescription>All shifts in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('job.title')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('work.type')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('client.project')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('date')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('location')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('required.workers')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tShifts('compensation')}</th>
                  <th className="text-left p-4 font-medium text-gray-500 dark:text-gray-400">{tCommon('status')}</th>
                  <th className="text-right p-4 font-medium text-gray-500 dark:text-gray-400">{tCommon('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {mockShifts.map((shift) => (
                  <tr key={shift.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="p-4 font-medium">{shift.title}</td>
                    <td className="p-4 text-gray-600 dark:text-gray-300">{shift.workType}</td>
                    <td className="p-4 text-gray-600 dark:text-gray-300">{shift.client}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Calendar className="h-4 w-4" />
                        {shift.date}
                        <Clock className="h-4 w-4" />
                        {shift.startTime} - {shift.endTime}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <MapPin className="h-4 w-4" />
                        {shift.location}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className="font-medium">{shift.assignedWorkers}/{shift.requiredWorkers}</span>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-300">{shift.compensation}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(shift.status)}`}>
                        {getStatusLabel(shift.status)}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}