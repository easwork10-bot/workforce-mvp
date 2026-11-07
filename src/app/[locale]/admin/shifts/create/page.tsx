"use client";

import { useRef, useState } from 'react';
import { Link, useRouter } from '@/shared/i18n-routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/frontend/ui/button';
import { Input } from '@/frontend/ui/input';
import { Label } from '@/frontend/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/frontend/ui/card';
import { Textarea } from '@/frontend/ui/textarea';
import { ArrowLeft, MapPin, Euro } from 'lucide-react';
import {
  AdminShiftApiError,
  createAdminShift,
  type AdminShiftInput,
} from '@/frontend/features/admin-shifts/adminShiftsApi';
import { dutchLocalDateTimeToIso } from '@/frontend/features/admin-shifts/dutchDateTime';

type ShiftFormData = {
  title: string;
  workType: string;
  clientOrProject: string;
  location: string;
  latitude: string;
  longitude: string;
  date: string;
  startTime: string;
  endTime: string;
  requiredWorkers: string;
  compensationType: 'hourly' | 'fixed' | 'daily';
  compensationAmount: string;
  description: string;
  instructions: string;
};

export default function CreateShiftPage() {
  const tShifts = useTranslations('shifts');
  const tCommon = useTranslations('common');
  const tManagement = useTranslations('adminShiftManagement');
  const router = useRouter();

  const [formData, setFormData] = useState<ShiftFormData>({
    title: '',
    workType: '',
    clientOrProject: '',
    location: '',
    latitude: '',
    longitude: '',
    date: '',
    startTime: '',
    endTime: '',
    requiredWorkers: '1',
    compensationType: 'hourly',
    compensationAmount: '',
    description: '',
    instructions: '',
  });

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    setFieldErrors([]);

    submitting.current = true;
    setLoading(true);

    try {
      const numericValues = [
        formData.latitude,
        formData.longitude,
        formData.compensationAmount,
      ].filter((value) => value.trim() !== '');
      if (numericValues.some((value) => !Number.isFinite(Number(value)))) {
        setError(tManagement('invalidNumber'));
        return;
      }

      const startAt = dutchLocalDateTimeToIso(formData.date, formData.startTime);
      const endAt = dutchLocalDateTimeToIso(formData.date, formData.endTime);
      if (new Date(endAt) <= new Date(startAt)) {
        setError(tManagement('invalidLocalTime'));
        return;
      }

      const optionalNumber = (value: string): number | null => (
        value.trim() === '' ? null : Number(value)
      );
      const input: AdminShiftInput = {
        title: formData.title,
        workType: formData.workType,
        clientOrProject: formData.clientOrProject.trim() || null,
        location: formData.location,
        latitude: optionalNumber(formData.latitude),
        longitude: optionalNumber(formData.longitude),
        startAt,
        endAt,
        requiredWorkers: Number(formData.requiredWorkers),
        compensationType: formData.compensationType,
        compensationAmount: optionalNumber(formData.compensationAmount),
        description: formData.description.trim() || null,
        instructions: formData.instructions.trim() || null,
      };
      await createAdminShift(input);
      router.push('/admin/shifts');
    } catch (err) {
      if (err instanceof RangeError) {
        setError(tManagement('invalidLocalTime'));
      } else if (err instanceof AdminShiftApiError) {
        setError(err.message || tManagement('submitError'));
        setFieldErrors(Object.values(err.details ?? {}).flat());
      } else {
        setError(tManagement('submitError'));
      }
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  const handleChange = <K extends keyof ShiftFormData>(field: K, value: ShiftFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <Link href="/admin/shifts" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4">
          <ArrowLeft className="h-4 w-4" />
          {tShifts('list')}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{tShifts('create')}</h1>
        <p className="text-muted-foreground mt-1">{tManagement('createDescription')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tShifts('create')}</CardTitle>
          <CardDescription>{tManagement('fillDetails')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md">
                {error}
                {fieldErrors.length > 0 && (
                  <ul className="mt-2 list-disc ps-5">
                    {fieldErrors.map((fieldError, index) => <li key={`${fieldError}-${index}`}>{fieldError}</li>)}
                  </ul>
                )}
              </div>
            )}

            {/* Basic Info */}
            <div className="space-y-6 border-b border-gray-200 dark:border-gray-700 pb-6">
              <h3 className="text-lg font-semibold">{tManagement('basicInfo')}</h3>

              <div className="space-y-2">
                <Label htmlFor="title">{tShifts('job.title')} *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  placeholder={tManagement('titlePlaceholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workType">{tShifts('work.type')} *</Label>
                <Input
                  id="workType"
                  value={formData.workType}
                  onChange={(e) => handleChange('workType', e.target.value)}
                  placeholder={tManagement('workTypePlaceholder')}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientOrProject">{tShifts('client.project')}</Label>
                <Input
                  id="clientOrProject"
                  value={formData.clientOrProject}
                  onChange={(e) => handleChange('clientOrProject', e.target.value)}
                  placeholder={tManagement('clientPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">{tShifts('location')} *</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    id="location"
                    className="pl-10"
                    value={formData.location}
                    onChange={(e) => handleChange('location', e.target.value)}
                    placeholder={tManagement('locationPlaceholder')}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => handleChange('latitude', e.target.value)}
                    placeholder="52.3676"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    value={formData.longitude}
                    onChange={(e) => handleChange('longitude', e.target.value)}
                    placeholder="4.9041"
                  />
                </div>
              </div>
            </div>

            {/* Date & Time */}
            <div className="space-y-6 border-b border-gray-200 dark:border-gray-700 pb-6">
              <h3 className="text-lg font-semibold">{tManagement('schedule')}</h3>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="date">{tShifts('date')} *</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleChange('date', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startTime">{tShifts('start.time')} *</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => handleChange('startTime', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endTime">{tShifts('end.time')} *</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => handleChange('endTime', e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Workers & Compensation */}
            <div className="space-y-6 border-b border-gray-200 dark:border-gray-700 pb-6">
              <h3 className="text-lg font-semibold">{tManagement('workersCompensation')}</h3>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="requiredWorkers">{tShifts('required.workers')} *</Label>
                  <Input
                    id="requiredWorkers"
                    type="number"
                    min="1"
                    value={formData.requiredWorkers}
                    onChange={(e) => handleChange('requiredWorkers', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compensationType">{tManagement('compensationType')}</Label>
                  <select
                    id="compensationType"
                    value={formData.compensationType}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'hourly' || value === 'fixed' || value === 'daily') {
                        handleChange('compensationType', value);
                      }
                    }}
                    className="input"
                  >
                    <option value="hourly">{tManagement('hourly')}</option>
                    <option value="fixed">{tManagement('fixed')}</option>
                    <option value="daily">{tManagement('daily')}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compensationAmount">{tManagement('amount')}</Label>
                  <div className="relative">
                    <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="compensationAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      className="pl-10"
                      value={formData.compensationAmount}
                      onChange={(e) => handleChange('compensationAmount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Description & Instructions */}
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">{tManagement('details')}</h3>

              <div className="space-y-2">
                <Label htmlFor="description">{tShifts('description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder={tManagement('descriptionPlaceholder')}
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructions">{tManagement('instructions')}</Label>
                <Textarea
                  id="instructions"
                  value={formData.instructions}
                  onChange={(e) => handleChange('instructions', e.target.value)}
                  placeholder={tManagement('instructionsPlaceholder')}
                  rows={3}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link href="/admin/shifts">
                <Button type="button" variant="outline">
                  {tCommon('cancel')}
                </Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading ? tCommon('loading') : tCommon('save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}