# Current roadmap and owner decisions

This is retained product intent, not an implementation promise. Verify current
behavior against [architecture](./architecture.md); priorities and acceptance
criteria require owner approval.

## Implemented foundation

- One self-hosted Workforce MVP uses Next.js, PostgreSQL and Redis. APIs enforce
  authorization; hiding UI controls is not an authorization boundary.
- Protected administrator, employee and attendance pages validate the access JWT
  and live Redis session on the server. API handlers remain the authoritative
  authorization boundary; the shared session check also requires an active profile.
  Deactivation/suspension attempts session revocation, and reactivation requires
  confirmed revocation before the account can become active. A supplied role in the
  employee-edit API replaces the account's previous role assignments; sessions with
  removed roles are rejected even if Redis revocation is incomplete.
- Employee shift browsing, application history and schedule, administrator shift
  management, application review and assignment management use real APIs.
- The attendance screen still needs real-data integration. Employee Schedule uses
  the Netherlands fallback timezone until a worksite timezone can be stored.
- Main's dashboard uses Dutch and Arabic locale-prefixed routes. The separate
  Jofra public-site static preview and its GitHub Pages base path are not part of
  this branch. A future Arabic-to-English change is not implemented.

## Future decisions

| Area | Remaining work |
|---|---|
| Workforce UI | Connect attendance with end-to-end coverage. |
| Accounts | Define invitation, account recovery and profile workflows. |
| Scheduling | Confirm availability, shift-change and direct-assignment policies. |
| Attendance | Define windows, corrections, review and missing-checkout rules. |
| Operations | Plan backups, migration approval, proxy trust and monitoring. |
| Personal data | Define collection, access, retention and deletion before real data entry. |

Preserve transactional audits, role and ownership checks, concurrency protections
and idempotent notifications. Historical plans are not current implementation
instructions.
