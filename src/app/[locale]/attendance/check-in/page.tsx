"use client";

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Button } from '@/frontend/ui/button';
import { MapPin, Clock, CheckCircle, AlertCircle, Satellite, Shield, Calendar } from 'lucide-react';

const mockTodaysShifts = [
  {
    id: '1',
    shiftTitle: 'Traffic Controller - Amsterdam',
    date: '2024-01-15',
    startTime: '08:00',
    endTime: '16:00',
    location: 'Amsterdam Central Station',
    status: 'confirmed',
    hasCheckedIn: false,
    hasCheckedOut: false,
  },
  {
    id: '2',
    shiftTitle: 'Cleaning Service - Rotterdam',
    date: '2024-01-16',
    startTime: '17:00',
    endTime: '22:00',
    location: 'Rotterdam Business Park',
    status: 'confirmed',
    hasCheckedIn: false,
    hasCheckedOut: false,
  },
];

export default function CheckInPage() {
  const tAttendance = useTranslations('attendance');
  const tCommon = useTranslations('common');

  const [todaysShifts, setTodaysShifts] = useState(mockTodaysShifts);
  const [loading, setLoading] = useState(false);
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    // Check if GPS is available
    if ('geolocation' in navigator) {
      setGpsEnabled(true);
    }
  }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(pos);
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setLocationError('Location permission denied. Please enable location access in your browser settings.');
            break;
          case err.POSITION_UNAVAILABLE:
            setLocationError('Location information is unavailable.');
            break;
          case err.TIMEOUT:
            setLocationError('Location request timed out.');
            break;
          default:
            setLocationError('An unknown error occurred.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleCheckIn = async (shiftId: string) => {
    setLoading(true);
    requestLocation();

    // Wait for location or timeout
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // TODO: Implement actual Supabase check-in
      console.log('Checking in for shift:', shiftId, 'Location:', location);

      setTodaysShifts(prev =>
        prev.map(s =>
          s.id === shiftId ? { ...s, hasCheckedIn: true } : s
        )
      );
    } catch (err: any) {
      console.error('Check-in failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async (shiftId: string) => {
    setLoading(true);
    requestLocation();

    // Wait for location or timeout
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // TODO: Implement actual Supabase check-out
      console.log('Checking out for shift:', shiftId, 'Location:', location);

      setTodaysShifts(prev =>
        prev.map(s =>
          s.id === shiftId ? { ...s, hasCheckedOut: true } : s
        )
      );
    } catch (err: any) {
      console.error('Check-out failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  };

  const now = new Date();

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tAttendance('check_in')}</h1>
          <p className="text-muted-foreground mt-2">
            Record your attendance for today's shifts
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono font-bold">{formatTime(now)}</p>
          <p className="text-sm text-muted-foreground">{now.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {/* GPS Status Card */}
      <Card className={gpsEnabled ? 'border-green-500' : 'border-yellow-500'}>
        <CardHeader>
          <div className="flex items-center gap-2">
            {gpsEnabled ? (
              <Satellite className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            )}
            <CardTitle className="text-lg">
              {gpsEnabled ? 'GPS Available' : 'GPS Not Available'}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-center gap-2 mb-1">
                {location ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <Clock className="h-5 w-5 text-gray-400" />
                )}
                <span className="font-medium">Location</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {location
                  ? `${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`
                  : 'Not retrieved'}
              </p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Shield className="h-5 w-5 text-blue-600" />
                <span className="font-medium">Accuracy</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {location ? `±${Math.round(location.coords.accuracy)}m` : 'N/A'}
              </p>
            </div>
            <div className="text-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <Button variant="outline" size="sm" onClick={requestLocation} disabled={loading}>
                <Satellite className="h-4 w-4 mr-2" />
                Refresh Location
              </Button>
            </div>
          </div>
          {locationError && (
            <div className="mt-3 p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md">
              {locationError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* TodayToday'sapos;s Shifts */}
      <Card>
        <CardHeader>
          <CardTitle>TodayToday'sapos;s Shifts</CardTitle>
          <CardDescription>Check in and out for your assigned shifts</CardDescription>
        </CardHeader>
        <CardContent>
          {todaysShifts.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium">No shifts today</h3>
              <p className="text-muted-foreground mt-1">You have no shifts scheduled for today</p>
            </div>
          ) : (
            <div className="space-y-4">
              {todaysShifts.map((shift) => (
                <div key={shift.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{shift.shiftTitle}</h3>
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {shift.location}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{shift.startTime} - {shift.endTime}</p>
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {shift.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Check In */}
                    <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-5 w-5 text-blue-600" />
                        <span className="font-medium">{tAttendance('check_in')}</span>
                      </div>
                      {shift.hasCheckedIn ? (
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-5 w-5" />
                          <span>Checked in at {formatTime(new Date())}</span>
                        </div>
                      ) : (
                        <Button
                          className="w-full"
                          onClick={() => handleCheckIn(shift.id)}
                          disabled={loading || shift.hasCheckedOut}
                        >
                          {loading ? tCommon('loading') : tAttendance('check_in')}
                        </Button>
                      )}
                    </div>

                    {/* Check Out */}
                    <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-5 w-5 text-orange-600" />
                        <span className="font-medium">{tAttendance('check_out')}</span>
                      </div>
                      {shift.hasCheckedOut ? (
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-5 w-5" />
                          <span>Checked out at {formatTime(new Date())}</span>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => handleCheckOut(shift.id)}
                          disabled={loading || !shift.hasCheckedIn || shift.hasCheckedOut}
                        >
                          {loading ? tCommon('loading') : tAttendance('check_out')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-3 text-center">
            <div className="p-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mx-auto mb-2">
                <Satellite className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <h4 className="font-medium">GPS Verification</h4>
              <p className="text-sm text-muted-foreground mt-1">Your location is recorded to verify you're at the work site</p>
            </div>
            <div className="p-4">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-2">
                <Shield className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h4 className="font-medium">Secure & Private</h4>
              <p className="text-sm text-muted-foreground mt-1">Location data is only used for attendance verification</p>
            </div>
            <div className="p-4">
              <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mx-auto mb-2">
                <Clock className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <h4 className="font-medium">Accurate Timing</h4>
              <p className="text-sm text-muted-foreground mt-1">Server-side timestamps ensure accurate hour tracking</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}