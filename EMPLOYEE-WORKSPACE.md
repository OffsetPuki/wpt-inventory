# Employee workspace — phase 1

Employee accounts open a phone-friendly workspace: Today, My jobs, My time,
Messages, and Me. Owners use **Team → Employee approvals** for time review,
job assignments, and payroll setup.

## Connected workflow

1. Link each login to exactly one HR employee profile and set its dated pay rate.
2. Assign jobs through Employee approvals or an employee's task assignment.
   Explicitly removing job access overrides task-derived access.
3. Employees clock into a job or shop work. Switching jobs, breaks, and meals
   create segments of one shift in the existing time ledger.
4. Clocking out submits the shift. The owner approves it or requests changes.
5. Approved paid minutes feed the existing gross-pay worksheet, dated labor
   costs, and configured overtime calculations. Payroll closing blocks unresolved
   hours, overlapping entries, correction requests, and missing payroll links.

Regular breaks initially count as paid; meals initially count as unpaid. Review
these settings under Team setup. Setting changes apply only to future segments.
Signing out does not clock out. Long shifts are flagged rather than auto-stopped.
Owners can record a missed finish time with an explanation, then review the shift.

## Corrections and safeguards

- Employees request missed time or corrections with a reason. They cannot edit
  or delete original time directly, or approve their own requests.
- A correction request withdraws the affected shift from payable and billable
  totals. After accepting or declining it, review the shift again. For an older
  standalone entry, declining restores its prior approval state.
- Billed hours and closed payroll remain locked. Use the existing owner payroll
  adjustment workflow for those records; closed snapshots are preserved.
- Clock requests have persistent retry identifiers and shift versions. Retrying
  after a lost response returns the saved result; conflicting screens refresh.
- Offline punches are not queued. Reconnect to save, or request missed time.

## Employee access

Employees can read only their assigned jobs, safe customer contact details,
tasks, materials, job files, and team comments. They can update their own task
status and post a team update. Owner notes, prices, customer lists, other
employees' HR data, and management APIs are restricted on the server.

Time off stays pending until an owner decides it. Approval status and review
notifications are visible to the employee. Account security and sign-out remain
available under Me. Inventory management remains with owners in this phase.

## Rollout

The migration adds shift, assignment, policy, and correction tables and three
columns to the existing time ledger. It is repeatable. Previously completed
hours retain their legacy eligibility; existing payroll snapshots and approved
time off are preserved. A running legacy timer is closed explicitly into a
reviewable shift without creating another time entry.

Use the normal database backup and release process. Before enabling employee
access, review login/profile links, dated rates, assignments, and break settings.
This phase connects the existing payroll worksheet; it does not add a third-party
payroll provider, tax calculation, pay stubs, or bank transfers.

## Verification

- `npm run test:employee`: real isolated API/SQLite workflow, authorization,
  retries, paid/unpaid segments, corrections, historical locks, and payroll.
- `npm run check` and `npm run build`: types and production bundles.
- `node --import tsx node_modules/@playwright/test/cli.js test --project=employee`:
  phone layouts at 320/390 pixels, offline controls, saved-response recovery,
  tasks, messages, approval, and payroll integration.
- `npm test`: existing business-suite regression coverage plus employee checks.

Tests use temporary databases and mock external services; they do not change
live employee accounts, payroll, or customer data.
