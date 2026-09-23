# TODO

Open work for the dashboard. The full reasoning and design for each item lives in
[ROADMAP.md](ROADMAP.md). This file is the short checklist. Nothing here is broken; every item
was parked on purpose.

## Parked features (from ROADMAP.md, most valuable first)

- [ ] **Arrival date and due-back date.** Rename the job form's "Due date" label to arrival date,
      and derive the due-back date from labour hours (8h days, Mon–Fri). Schedule should span every
      working day a job occupies. Designed, not built (parked 16/08/2026).
- [ ] **Job value on the jobs list.** Add a total column (labour + parts) so the value on the floor
      is visible at a glance.
- [ ] **"Ready to invoice" tile on the Overview.** Count and value of jobs with work entered but no
      invoice yet.
- [ ] **Private repository.** Blocked by the Vercel Hobby plan. It needs commits authored by the
      Vercel account owner, or a move to Pro.

## Recurring checks

- [ ] Confirm the daily keep-alive cron (`/api/health`) is running: Vercel → project → Cron Jobs.
      It is the only thing stopping Supabase pausing the free database.
