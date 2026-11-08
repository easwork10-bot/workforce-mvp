# Current roadmap and owner decisions

This is retained product intent, not an implementation promise. Verify current
behavior against [architecture](./architecture.md); priorities and acceptance
criteria require owner approval.

## Current foundation

- One self-hosted Workforce MVP uses Next.js, PostgreSQL and Redis. APIs enforce
  authorization; hiding UI controls is not an authorization boundary.
- Employee shift browsing and application history, administrator shift management,
  application review and assignment management use real APIs.
- Employee schedule and attendance screens still need real-data integration.
- Main's dashboard uses Dutch and Arabic locale-prefixed routes. The separate
  Jofra public-site static preview and its GitHub Pages base path are not part of
  this branch. A future Arabic-to-English change is not implemented.

## Next decisions

| Area | Remaining work |
|---|---|
| Workforce UI | Connect employee schedule and attendance with end-to-end coverage. |
| Accounts | Define invitation, account recovery and profile workflows. |
| Scheduling | Confirm availability, shift-change and direct-assignment policies. |
| Attendance | Define windows, corrections, review and missing-checkout rules. |
| Operations | Plan backups, migration approval, proxy trust and monitoring. |
| Personal data | Define collection, access, retention and deletion before real data entry. |

Preserve transactional audits, role and ownership checks, concurrency protections
and idempotent notifications. Historical plans are not current implementation
instructions.
