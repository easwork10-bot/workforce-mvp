"use client";

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin, Clock, Users, Euro, CheckCircle } from 'lucide-react';
import Link from 'next/link';

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
    appliedWorkers: 3,
    compensation: '€18.50/hour',
    status: 'open',
    hasApplied: false,
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
    appliedWorkers: 2,
    compensation: '€15.00/hour',
    status: 'open',
    hasApplied: true,
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
    appliedWorkers: 1,
    compensation: '€16.50/hour',
    status: 'open',
    hasApplied: false,
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
    appliedWorkers: 5,
    compensation: '€20.00/hour',
    status: 'open',
    hasApplied: false,
  },
];

export default function EmployeeShiftsPage() {
  const tShifts = useTranslations('shifts');
  const tEmployee = useTranslations('employee');

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tEmployee('available.shifts')}</h1>
          <p className="text-muted-foreground mt-1">Browse and apply for available shifts</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {mockShifts.map((shift) => (
          <Card key={shift.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{shift.title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{shift.workType}</p>
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  {tShifts('status.open')}
                </span>
              </div>
              <CardDescription>{shift.client}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Calendar className="h-4 w-4" />
                {shift.date}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Clock className="h-4 w-4" />
                {shift.startTime} - {shift.endTime}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <MapPin className="h-4 w-4" />
                {shift.location}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Users className="h-4 w-4" />
                {shift.appliedWorkers}/{shift.requiredWorkers} applied
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
                <Euro className="h-4 w-4" />
                {shift.compensation}
              </div>
            </CardContent>
            <CardFooter className="flex items-center p-4 pt-0 border-t border-gray-100 dark:border-gray-800">
              {shift.hasApplied ? (
                <Button variant="secondary" className="w-full" disabled>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {tShifts('application.applied')}
                </Button>
              ) : (
                <Link href={`/employee/shifts/${shift.id}/apply`}>
                  <Button className="w-full" variant="outline">
                    {tShifts('apply')}
                  </Button>
                </Link>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      {mockShifts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No shifts available</h3>
            <p className="text-muted-foreground mt-1">Check back later for new opportunities</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}