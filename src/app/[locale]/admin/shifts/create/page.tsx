"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { ArrowLeft, MapPin, Euro } from 'lucide-react';

export default function CreateShiftPage() {
  const tShifts = useTranslations('shifts');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [formData, setFormData] = useState({
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
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic validation
    if (!formData.title || !formData.workType || !formData.location || !formData.date || !formData.startTime || !formData.endTime) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);

    try {
      // TODO: Implement actual Supabase insert
      // For now, just redirect back to shifts list
      console.log('Creating shift:', formData);
      router.push('/admin/shifts');
    } catch (err: any) {
      setError(err.message || 'Failed to create shift');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <Link href="/admin/shifts" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Shifts
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{tShifts('create')}</h1>
        <p className="text-muted-foreground mt-1">Create a new shift for employees to apply to</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tShifts('create')}</CardTitle>
          <CardDescription>Fill in the shift details below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md">
                {error}
              </div>
            )}

            {/* Basic Info */}
            <div className="space-y-6 border-b border-gray-200 dark:border-gray-700 pb-6">
              <h3 className="text-lg font-semibold">Basic Information</h3>

              <div className="space-y-2">
                <Label htmlFor="title">{tShifts('job.title')} *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  placeholder="e.g., Traffic Controller - Amsterdam"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="workType">{tShifts('work.type')} *</Label>
                <Input
                  id="workType"
                  value={formData.workType}
                  onChange={(e) => handleChange('workType', e.target.value)}
                  placeholder="e.g., Traffic Control, Cleaning, Logistics"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientOrProject">{tShifts('client.project')}</Label>
                <Input
                  id="clientOrProject"
                  value={formData.clientOrProject}
                  onChange={(e) => handleChange('clientOrProject', e.target.value)}
                  placeholder="Client or project name"
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
                    placeholder="e.g., Amsterdam Central Station"
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
              <h3 className="text-lg font-semibold">Date & Time</h3>

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
              <h3 className="text-lg font-semibold">Workers & Compensation</h3>

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
                  <Label htmlFor="compensationType">Compensation Type</Label>
                  <select
                    id="compensationType"
                    value={formData.compensationType}
                    onChange={(e) => handleChange('compensationType', e.target.value)}
                    className="input"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="fixed">Fixed Amount</option>
                    <option value="daily">Daily Rate</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compensationAmount">Amount</Label>
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
              <h3 className="text-lg font-semibold">Details</h3>

              <div className="space-y-2">
                <Label htmlFor="description">{tShifts('description')}</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Describe the shift, tasks, and requirements..."
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="instructions">Instructions for Workers</Label>
                <Textarea
                  id="instructions"
                  value={formData.instructions}
                  onChange={(e) => handleChange('instructions', e.target.value)}
                  placeholder="Any special instructions, meeting points, dress code, etc."
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