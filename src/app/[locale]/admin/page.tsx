"use client";

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { Users, Calendar, Clock, TrendingUp, Plus, Search } from 'lucide-react';
import { Link } from '@/shared/i18n-routing';

export default function AdminDashboard() {
  const tAdmin = useTranslations('admin');
  const tShifts = useTranslations('shifts');
  const tAttendance = useTranslations('attendance');

  // Mock data for now - will be replaced with real data from Supabase
  const stats = [
    { title: tAdmin('dashboard'), value: '45', change: '+2 from last month', icon: Users },
    { title: tShifts('title'), value: '12', change: '3 waiting for approval', icon: Calendar },
    { title: tAttendance('title'), value: '38', change: '3 checked in late', icon: Clock },
    { title: tAdmin('reports'), value: '156', change: 'This month', icon: TrendingUp },
  ];

  const recentShifts = [
    { title: 'Traffic Controller - Amsterdam', date: '2024-01-15', workers: '2 workers assigned', status: 'Active', color: 'text-green-600' },
    { title: 'Cleaning Service - Rotterdam', date: '2024-01-16', workers: '5 workers assigned', status: 'Prepared', color: 'text-blue-600' },
    { title: 'Logistics Support - Utrecht', date: '2024-01-17', workers: '1 worker assigned', status: 'Pending', color: 'text-orange-600' },
  ];

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tAdmin('dashboard')}</h1>
          <p className="text-muted-foreground mt-2">
            Manage your workforce, shifts, and attendance
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>{tShifts('list')}</CardTitle>
            <CardDescription>Latest shift activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentShifts.map((shift, index) => (
                <div key={index} className="flex items-center">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{shift.title}</p>
                    <p className="text-sm text-muted-foreground">Date: {shift.date} | {shift.workers}</p>
                  </div>
                  <div className="ml-auto font-medium">{shift.status}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/shifts/create">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Plus className="h-4 w-4" />
                Create New Shift
              </Button>
            </Link>
            <Link href="/admin/employees/create">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Users className="h-4 w-4" />
                Add New Employee
              </Button>
            </Link>
            <Link href="/admin/shifts">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Search className="h-4 w-4" />
                View All Shifts
              </Button>
            </Link>
            <Link href="/admin/employees">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Users className="h-4 w-4" />
                Manage Employees
              </Button>
            </Link>
            <Link href="/attendance">
              <Button className="w-full justify-start gap-2" variant="outline">
                <Clock className="h-4 w-4" />
                View Attendance
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}