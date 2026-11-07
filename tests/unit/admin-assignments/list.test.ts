import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import AdminAssignmentList, { AdminAssignmentListView } from '@/frontend/features/admin-assignments/AdminAssignmentList';
import { assignmentStatuses, type AdminAssignmentPage } from '@/shared/admin-assignments';
import nl from '@/locales/nl.json';
import ar from '@/locales/ar.json';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const data: AdminAssignmentPage = {
  assignments: assignmentStatuses.map((status, index) => ({
    id: `c2df4e6f-72a7-4e7a-9de1-${String(index + 1).padStart(12, '0')}`,
    shiftId: id, employeeId: id, assignedBy: id, applicationId: null,
    status, assignedAt: '2026-11-01T10:00:00.000Z', confirmedAt: null,
    employee: { id, fullName: 'API employee <safe>' },
    shift: {
      id, title: 'API overnight shift', location: 'Amsterdam',
      startAt: '2026-11-02T22:00:00.000Z', endAt: '2026-11-03T06:00:00.000Z',
    },
  })),
  pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
};

function render(locale: 'nl' | 'ar', overrides: Partial<Parameters<typeof AdminAssignmentListView>[0]> = {}) {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale, messages: locale === 'ar' ? ar : nl, timeZone: 'Europe/Amsterdam',
  }, createElement(AdminAssignmentListView, {
    data, status: '', error: null, loading: false,
    selected: null, saving: false, feedback: null,
    onSelect: () => {}, onDismiss: () => {}, onConfirm: () => {},
    onStatusChange: () => {}, onPageChange: () => {}, onRefresh: () => {}, ...overrides,
  })));
}

for (const locale of ['nl', 'ar'] as const) {
  const text = (locale === 'ar' ? ar : nl).adminAssignmentManagement;
  describe(`${locale} assignments view`, () => {
    it('renders backend employee/shift data, all history states and accessible semantic controls', () => {
      const html = render(locale);
      expect(html).toContain(text.title);
      expect(html).toContain('API employee &lt;safe&gt;');
      expect(html).toContain('API overnight shift');
      expect(html).toContain('Amsterdam');
      expect(html.match(/<li /g)).toHaveLength(4);
      for (const status of assignmentStatuses) expect(html).toContain(text.status[status]);
      expect(html).toContain('<label for="assignment-status"');
      expect(html).toContain('aria-label="' + text.list + '"');
      expect(html).toContain('aria-label="' + text.pagination.replaceAll("'", '&#x27;') + '"');
      expect(html).toContain('<bdi>');
      expect(html).toContain('aria-busy="false"');
      expect(html.match(/<button[^>]* disabled=""/g)).toHaveLength(2);
      expect(html).not.toContain('Approve');
      expect(html.split(text.cancel).length - 1).toBe(2);
    });

    it('shows full localized start/end dates and assignment time in Amsterdam, including overnight end date', () => {
      const html = render(locale);
      const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'nl-NL', {
        timeZone: 'Europe/Amsterdam', dateStyle: 'medium', timeStyle: 'short',
      });
      for (const timestamp of [data.assignments[0].shift.startAt, data.assignments[0].shift.endAt, data.assignments[0].assignedAt]) {
        expect(html).toContain(`dateTime="${timestamp}"`);
        expect(html).toContain(date.format(new Date(timestamp)));
      }
      expect(html).toContain(text.start);
      expect(html).toContain(text.end);
      expect(html).toContain(text.assignedAt);
    });

    it('shows loading without stale rows and disables refresh', () => {
      const html = render(locale, { loading: true });
      expect(html).toContain(text.loading);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).not.toContain('API overnight shift');
      expect(html).toContain('disabled=""');
    });

    it('shows an empty state with both pagination boundaries disabled', () => {
      const html = render(locale, { data: { assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
      expect(html).toContain(text.empty);
      expect(html).not.toContain('API overnight shift');
      expect(html.match(/<button[^>]* disabled=""/g)).toHaveLength(2);
    });

    it('shows localized retry feedback without stale data', () => {
      const html = render(locale, { error: text.loadError });
      expect(html).toContain('role="alert"');
      expect(html).toContain(text.loadError);
      expect(html).toContain(text.retry);
      expect(html).not.toContain('API overnight shift');
    });

    it('uses server pagination metadata and current filter selection', () => {
      const html = render(locale, {
        data: { ...data, pagination: { page: 2, limit: 20, total: 41, totalPages: 3 } }, status: 'cancelled',
      });
      expect(html).toContain('<option value="cancelled" selected=""');
      expect(html).not.toContain('disabled=""');
      for (const value of [2, 3, 41]) expect(html).toContain(String(value));
    });

    it('disables list controls and cancellation actions while a mutation is pending', () => {
      const html = render(locale, { saving: true, data: { ...data, pagination: { page: 2, limit: 20, total: 41, totalPages: 3 } } });
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('<select id="assignment-status" class="input min-h-10 max-w-full" disabled=""');
      expect(html.match(/<button[^>]* disabled=""/g)).toHaveLength(5);
    });

    it('keeps mutation feedback distinct from refresh errors and hides stale rows', () => {
      const html = render(locale, { feedback: { error: false, message: text.cancelled }, error: text.loadError });
      expect(html).toContain(text.cancelled);
      expect(html).toContain(text.loadError);
      expect(html).toContain('role="status"');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('API overnight shift');
    });
  });
}

it('renders the fetching component initially as a localized loading state', () => {
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: 'nl', messages: nl, timeZone: 'Europe/Amsterdam',
  }, createElement(AdminAssignmentList)));
  expect(html).toContain(nl.adminAssignmentManagement.loading);
});
