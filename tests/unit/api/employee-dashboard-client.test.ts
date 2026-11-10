import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployeeDashboard } from '@/frontend/features/employee-dashboard/employeeDashboardApi';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';
import { readFileSync } from 'node:fs';

const summary = { month: '2027-03', timeZone: 'Europe/Amsterdam', pendingApplications: 0, acceptedThisMonth: 2, workedHoursThisMonth: 1.5, recentApplications: [] };
afterEach(() => vi.unstubAllGlobals());
describe('dashboard client and translations', () => {
  it('requests authenticated uncached data and accepts real zero values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(summary));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect(await fetchEmployeeDashboard(signal)).toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith('/api/employee/dashboard', {
      credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
    });
  });
  it.each([401, 403, 503])('preserves status %s for localized errors', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(fetchEmployeeDashboard()).rejects.toMatchObject({ status });
  });
  it.each([{ pendingApplications: -1 }, { workedHoursThisMonth: '84' }, { recentApplications: [{}] }])('rejects malformed data %j', async invalid => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...summary, ...invalid })));
    await expect(fetchEmployeeDashboard()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('preserves abort failures', async () => {
    const error = new DOMException('Cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(fetchEmployeeDashboard()).rejects.toBe(error);
  });
  it('has matching Dutch and Arabic keys, including every dashboard label and status', () => {
    expect(Object.keys(ar.employeeDashboard).sort()).toEqual(Object.keys(nl.employeeDashboard).sort());
    const source = readFileSync('src/app/[locale]/employee/EmployeeDashboard.tsx', 'utf8');
    const keys = [...source.matchAll(/\bt\('([^']+)'\)/g)].map(match => match[1]);
    keys.push('pending', 'pendingDescription', 'accepted', 'acceptedDescription', 'hours', 'hoursDescription');
    for (const dictionary of [nl.employeeDashboard, ar.employeeDashboard]) {
      for (const key of keys) expect((dictionary as Record<string, unknown>)[key], key).toEqual(expect.any(String));
      expect(Object.keys(dictionary.statuses).sort()).toEqual(['accepted', 'cancelled', 'pending', 'rejected']);
    }
  });
});
