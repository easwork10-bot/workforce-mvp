"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { Clock, MapPin, CheckCircle, ChevronLeft, ChevronRight, Sun } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, isToday } from 'date-fns';
import { nl } from 'date-fns/locale';

const mockAssignments = [
  {
    id: '1',
    shiftTitle: 'Traffic Controller - Amsterdam',
    date: '2024-01-15',
    startTime: '08:00',
    endTime: '16:00',
    location: 'Amsterdam Central Station',
    status: 'confirmed',
  },
  {
    id: '2',
    shiftTitle: 'Cleaning Service - Rotterdam',
    date: '2024-01-16',
    startTime: '17:00',
    endTime: '22:00',
    location: 'Rotterdam Business Park',
    status: 'confirmed',
  },
  {
    id: '3',
    shiftTitle: 'Logistics Support - Utrecht',
    date: '2024-01-17',
    startTime: '06:00',
    endTime: '14:00',
    location: 'Utrecht Distribution Center',
    status: 'confirmed',
  },
];

export default function EmployeeSchedulePage() {
  const tEmployee = useTranslations('employee');
  const tCommon = useTranslations('common');

  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [view, setView] = useState<'week' | 'month'>('week');

  const dateFnsLocale = nl;

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1, locale: dateFnsLocale });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1, locale: dateFnsLocale });

  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    return day;
  });

  const getShiftsForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return mockAssignments.filter(a => a.date === dateStr);
  };

  const goToToday = () => {
    setCurrentWeek(new Date());
  };

  const goToPreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const weekLabel = `${format(weekStart, 'dd MMM', { locale: dateFnsLocale })} - ${format(weekEnd, 'dd MMM yyyy', { locale: dateFnsLocale })}`;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tEmployee('my.schedule')}</h1>
          <p className="text-muted-foreground mt-1">View your weekly and monthly schedule</p>
        </div>
      </div>

      {/* Week/Month Navigation */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium text-lg min-w-[200px] text-center">{weekLabel}</span>
              <Button variant="outline" size="sm" onClick={goToNextWeek}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={goToToday}>
                <Sun className="h-4 w-4 mr-2" />
                {tCommon('today') || 'Today'}
              </Button>
              <div className="flex border border-gray-300 dark:border-gray-700 rounded-md overflow-hidden">
                <Button
                  variant={view === 'week' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setView('week')}
                  className="rounded-none border-r"
                >
                  Week
                </Button>
                <Button
                  variant={view === 'month' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setView('month')}
                  className="rounded-none"
                >
                  Month
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly View */}
      {view === 'week' && (
        <div className="grid gap-4">
          {days.map((day) => {
            const shifts = getShiftsForDay(day);
            const isTodayDay = isToday(day);

            return (
              <Card key={day.toISOString()} className={isTodayDay ? 'ring-2 ring-blue-500' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`text-center p-2 rounded-lg ${isTodayDay ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        <p className="text-sm font-medium">{format(day, 'EEE', { locale: dateFnsLocale })}</p>
                        <p className="text-2xl font-bold">{format(day, 'd', { locale: dateFnsLocale })}</p>
                        <p className="text-xs text-muted-foreground">{format(day, 'MMM', { locale: dateFnsLocale })}</p>
                      </div>
                      <div>
                        <h3 className="font-semibold">{format(day, 'EEEE, d MMMM yyyy', { locale: dateFnsLocale })}</h3>
                        {isTodayDay && <span className="text-sm text-blue-600 dark:text-blue-400">Today</span>}
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground">{shifts.length} shift{shifts.length !== 1 ? 's' : ''}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {shifts.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">No shifts scheduled</p>
                  ) : (
                    <div className="space-y-3">
                      {shifts.map((shift) => (
                        <div key={shift.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                              <Clock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <p className="font-medium">{shift.shiftTitle}</p>
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {shift.startTime} - {shift.endTime}
                              </p>
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {shift.location}
                              </p>
                            </div>
                          </div>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {shift.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Monthly View - Simplified */}
      {view === 'month' && (
        <Card>
          <CardContent className="py-4">
            <p className="text-center text-muted-foreground">Monthly calendar view coming soon</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}