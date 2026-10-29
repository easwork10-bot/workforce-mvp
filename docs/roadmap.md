# Current roadmap and owner decisions

This is retained product intent, not an implementation promise or a new
architecture proposal. Verify status against [architecture](./architecture.md)
and current code. Priorities and acceptance criteria require owner approval.

## Current foundation

- Responsive Dutch/Arabic website first; no separate native mobile application.
- Single-company Workforce MVP before considering multi-company SaaS.
- Self-hosted Next.js APIs, PostgreSQL/Drizzle and Redis; Supabase is not an
  active dependency. Authorization is enforced by APIs, not hidden UI controls.
- Employee shift browsing/applications, registration/login and related APIs
  exist. Several admin, schedule and attendance screens still use sample data.
- Notifications are in-app records; email for public Jofra forms is a separate
  Resend integration. Pages is a static preview, not a backend deployment.

## Next product work (not completed)

| Area | Remaining work / decision |
|---|---|
| Workforce UI | Connect admin employee/shift/application review, employee schedule and attendance screens to existing APIs; remove sample-data assumptions only with end-to-end coverage |
| Accounts | Define invitation, account recovery and profile/qualification/document workflows |
| Scheduling | Confirm cancellation, availability, holidays, shift-change and direct-assignment policies |
| Attendance | Define time windows, corrections, supervisor review and missing checkout rules; GPS coordinates are not proof of presence or implemented geofencing |
| Jofra launch | Owner approves photographs/copy, physical iPhone/Android checks, Node hosting and controlled email delivery |
| Operations | Production backups/restore and migration approval, HTTPS/proxy IP trust, monitoring and scheduler ownership across replicas |
| Personal data | Minimize bank/government-ID/document collection; define legal basis, access, retention and deletion before real data entry |

## Later possibilities, not MVP requirements

PWA installation/offline behavior and Web Push require platform testing.
Native apps, messaging/attachments, document storage, automatic matching,
payroll-related views, timesheets, maps, PDF/Excel reports and multi-company
support remain optional. Do not describe estimated earnings as payroll, coordinates
as geofence enforcement, or an available schema field as a completed workflow.

## Decisions preserved from earlier plans

Keep parameterized queries, explicit role/resource ownership checks, transactional
audits for business mutations, concurrency/capacity protections and idempotent
notification creation. Keep bounded feature scope and existing API contracts.
The removed dated plans used former `src/lib/db` paths, obsolete status matrices
and Supabase assumptions; their code examples are not instructions to execute.
Git history retains them if their original context is needed.
