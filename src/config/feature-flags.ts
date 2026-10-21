"use client";

interface FeatureFlags {
  gpsCheckInEnabled: boolean;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  advancedAnalyticsEnabled: boolean;
  payrollIntegrationEnabled: boolean;
  multiCompanyEnabled: boolean;
}

const defaultFlags: FeatureFlags = {
  gpsCheckInEnabled: process.env.NEXT_PUBLIC_GPS_CHECKIN_ENABLED === 'true',
  pushNotificationsEnabled: process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === 'true',
  emailNotificationsEnabled: process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS_ENABLED === 'true',
  advancedAnalyticsEnabled: false,
  payrollIntegrationEnabled: false,
  multiCompanyEnabled: false
};

export function getFeatureFlags(): FeatureFlags {
  return { ...defaultFlags };
}

export const FEATURE_FLAGS = getFeatureFlags();