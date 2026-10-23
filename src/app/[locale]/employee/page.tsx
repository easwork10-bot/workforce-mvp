"use client";

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { Calendar, Clock, CheckCircle, AlertCircle, Users, Plus } from 'lucide-react';
import Link from 'next/link';

const mockUpcomingShifts = [
  {
    id: '1',
    title: 'Traffic Controller - Amsterdam',
    date: '2024-01-15',
    startTime: '08:00',
    endTime: '16:00',
    location: 'Amsterdam Central Station',
    status: 'confirmed',
  },
  {
    id: '2',
    title: 'Cleaning Service - Rotterdam',
    date: '2024-01-16',
    startTime: '17:00',
    endTime: '22:00',
    location: 'Rotterdam Business Park',
    status: 'confirmed',
  },
];

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
            <CardTitle className="text-sm font-medium">Upcoming Shifts</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2</div>
            <p className="text-xs text-muted-foreground">This week</p>
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
                <CardTitle>Upcoming Shifts</CardTitle>
                <CardDescription>Your confirmed shifts this week</CardDescription>
              </div>
              <Link href="/employee/schedule">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockUpcomingShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                      <Calendar className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="font-medium">{shift.title}</p>
                      <p className="text-sm text-muted-foreground">{shift.date} · {shift.startTime} - {shift.endTime}</p>
                      <p className="text-sm text-muted-foreground">{shift.location}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Confirmed
                  </span>
                </div>
              ))}
            </div>
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

        <Link href="/employee/schedule">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="flex flex-col items-center text-center py-6">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
                <Calendar className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle className="text-lg">My Schedule</CardTitle>
              <CardDescription>View your weekly/monthly calendar</CardDescription>
            </CardContent>
          </Card>
        </Link>

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