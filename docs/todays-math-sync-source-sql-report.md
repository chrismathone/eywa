# Source SQL implementation and verification

2026-10-03. Source-only implementation; no live database, environment, binding, account, or deployment was changed.

Coordinator follow-up: automatic onboarding was added at the user's request. `tm_sync_configure_automatic` is service-only and opts the installation into first-ON creation, preserving explicit mappings and operator shadow stops. The source tenant UUID is the stable binding and target branch UUID; control now includes the source tenant name. The first cron backfills already-ON licenses, and later ON changes register the binding and durable outbox in the license transaction. OFF/expiry/deletion preserve identities and generation history. `supabase/tests/todays_math_sync_automatic.sql` covers bootstrap, repeated calls, first ON, OFF/ON, explicit exclusions, expired licenses, rename and grants. The final runner now passes **11 SQL groups**, including the prior concurrency and wire-byte checks.

## Files and migration provenance

- `supabase/migrations/0337a_todays_math_sync_v2.sql`: additive, transactional, repeatable alpha migration. Created with `npx --yes supabase@2.81.3 migration new todays_math_sync_v2` as `20261003083350_todays_math_sync_v2.sql`, then moved to the repository's next alpha number after 0336. It must be applied through the existing alpha deployment procedure; Drizzle's numbered journal does not apply it.
- `scripts/verify-todays-math-sync-sql.mjs` and `supabase/tests/todays_math_sync{,_fixture,_recovery}.sql`: isolated SQL verification using the repository's existing `postgres` dependency and the real source migrations.

## RPC interface

Every public `tm_sync_*` RPC returns a JSON object/array or the scalar noted below and grants EXECUTE only to `service_role`. Private tables have RLS enabled, no policies, and no API-role table/schema access. Auth state is queried by the definer, never exported as Auth rows.

| RPC | Parameters and return |
| --- | --- |
| `tm_sync_control` | `p_binding_id uuid, p_user_id uuid = null` → frozen-contract Control or null for unknown binding. OFF/deleted tenants still return authoritative OFF. |
| `tm_sync_create_snapshot` | `p_binding_id uuid` → complete Manifest. Disabled/unhealthy export raises `PTS03`, never a normal empty snapshot. |
| `tm_sync_snapshot_page` | `p_binding_id uuid, p_snapshot_id uuid, p_kind text, p_page integer` → Page or null if binding/page/expiry mismatch. |
| `tm_sync_claim_events` | `p_limit integer` (1–100) → array of `{event,leaseToken,attempts}`. Security first; `SKIP LOCKED`; 180-second leases. |
| `tm_sync_finish_event` | `p_event_id uuid, p_lease_token uuid, p_status text, p_error text = null` → boolean. Status is `received`, `applied`, `conflict`, `superseded`, or `retry`. Expired/wrong lease returns false. Received schedules a status poll after 15 seconds; retry uses bounded exponential delay and jitter. |
| `tm_sync_consume_nonce` | `p_binding_id uuid, p_nonce uuid, p_expires_at timestamptz` → boolean. Unique insert; future expiry at most two minutes. |
| `tm_sync_issue_code` | `p_binding_id uuid, p_user_id uuid, p_code_hash text, p_state_hash text, p_challenge text` → boolean. Hashes are lowercase SHA-256 hex; PKCE challenge is 43-character base64url. Active mode/current qualification required. TTL 60 seconds. |
| `tm_sync_redeem_code` | Frozen four arguments: binding, code hash, state hash, challenge → `{control,user,jti,issuedAt,expiresAt}` or null. Locked one-time consumption and current eligibility/generation check. |
| `tm_sync_exchange_code` | Same four arguments plus `p_nonce uuid, p_expires_at timestamptz` → redemption result. **The HTTP token route must use this wrapper** so code and nonce are consumed in one DB transaction. |
| `tm_sync_reconcile` | No parameters → `{healthy,controlChecks,fullChecks}`. Minute invocation, five-minute security/roster digest, date-boundary wake, dirty content drain, daily full-content hash, and retention cleanup. |
| `tm_sync_configure_binding` | `p_binding_id uuid, p_tenant_id uuid, p_target_branch_id text, p_mode text = 'shadow', p_apply boolean = false` → preview/apply metadata. Mapping immutable; first apply must be shadow; one binding per source tenant/target branch. |
| `tm_sync_configure_wake` | `p_source_origin text, p_wake_secret text, p_apply boolean = false` → safe metadata. Fixed HTTPS origin (localhost HTTP allowed for isolated testing), trimmed secret ≥32 characters. Explicit apply is required. |
| `tm_sync_status` | `p_binding_id uuid = null` → array with mode, generations, health, queue counts, last success/reconcile/full check, oldest pending timestamp. No secret or business payload. |
| `tm_sync_schema_health` | No parameters → overall health, 20 trigger checks, nine function-definition checks, wake configuration/transport availability. |
| `tm_sync_retry_event` | `p_event_id uuid` → boolean; requeues conflict/retry/received work without stealing an active lease. |
| `tm_sync_recover_binding` | `p_binding_id uuid, p_expected_epoch uuid` → Control. Explicit operator recovery after required triggers/functions are repaired; increases protection generation and revision, clears the recording-gap latch, requests a new full comparison. Receiver must verify a new snapshot and require fresh login. |

`targetBranchId` travels as contract text; configure the actual target Branch ID (the current target Prisma database uses UUID IDs). Class `closedAt` is the exclusive UTC instant following the inclusive source date in KST; membership `endsOn` stays an inclusive YYYY-MM-DD date. Class grade is null because the source class has no authoritative grade column. All numeric revisions/generations cross the wire as decimal strings.

## Security and source rules

Mandatory triggers cover `tenants`, `tenant_licenses` (`todays_math` only), `users`, `auth.users` ban/soft-delete/role/delete, `super_admins` membership, `classes`, `class_schedules`, `class_delegations`, `students`, and `enrollments`. Explicit source columns use `IS DISTINCT FROM` filtering; password/login timestamps, unchanged Auth mirror updates, unrelated license updates, names, school, and report text do not bump security revisions. Mandatory record failure raises neutral retry error `PTS01` and rolls back the business write; source tables with configured bindings cannot be truncated.

Current qualification requires an active source user in the shared assignable roles, an explicit math subject, a present/nondeleted/unbanned authenticated Auth identity, an enabled/unexpired license, and healthy recording. Protected recovery identities are excluded entirely. No role bypass exists for OFF. Account/tenant revocation generations are separate from scoped class permissions and class-list revisions. Tombstones and bindings survive source deletion and never expire.

Homeroom and current slot memberships carry the shared seven capabilities; delegates carry only the four read capabilities. Date bounds are inclusive, future slots do not grant today, manual pending teacher handover never grants before source application, and `class_period_closed_end` is reused directly. Full relationship exports retain ended/upcoming/held enrollments and `isTransferred` so the receiver can distinguish inclusive ordinary end dates from exclusive transfer dates. Test students, other branches, English reports, and nonrequired contact/notes/payroll fields are excluded. Unattributed math progress retains null class IDs for receiver review; student matching is by source UUID only.

Snapshot export generation has its own row lock. A single STABLE SQL statement obtains all six collections and Control from one MVCC snapshot, then stores immutable pages with exact UTF-8 JSON-string SHA-256. Pages expire after 15 minutes; each contains at most 100 rows, with a 1.5 MB inner JSON-string bound and a 2 MiB complete serialized Page response bound (including second escaping). The complete Manifest is also bounded to 2 MiB. Oversize rejection atomically rolls back generation, manifest, and every page; API callers must treat export errors as unavailable, never as empty data.

The outbox insert is mandatory; `pg_net` wake is separately best effort, at most once per binding/source transaction, and posts only a binding ID to the fixed source dispatcher path. The private wake secret is never returned. `pg_net` installation/configuration is an explicit deployment step; minute cron remains the fallback. Content notifications use a best-effort dirty marker and wake; daily full-content hashing repairs lost dirty notifications.

A missing/disabled/changed required trigger or changed critical function immediately yields unhealthy Control. Reconcile latches a recording gap and increases protection generations. A changed security/roster digest without a recorded revision or known date boundary also latches the gap. Reenabling a trigger does not automatically clear a latched gap. An undetected historical OFF→ON while every detector was disabled cannot be reconstructed; controlled imports/restores must invoke the recovery procedure. Backup epoch rebaselining remains an explicit coordinated source/target operator action; the source never silently changes epoch.

## Executed verification

Run `node scripts/verify-todays-math-sync-sql.mjs --reset` against the coordinator-owned local PostgreSQL container on `127.0.0.1:55432`, database **eywa_source_test**. The runner refuses any other database and uses no application environment or live credentials. It recreates only that disposable database's test schemas, loads the actual predecessor migrations, applies this alpha twice, and leaves the small fixture available for integration testing.

PostgreSQL 17.11: all ten verification groups passed (final coordinator rerun after serialized Page/Manifest byte bounds were added). Evidence includes source/outbox/revision rollback on injected mandatory failure; report survival on content notification failure; OFF→ON and stale-code rejection; Auth ban/soft delete/role; no-op/password/Auth-mirror behavior; protected and ineligible identities; future/current/ended memberships and delegate capabilities; held/future/multiple enrollments; 207 students across three pages; exact hashes, expiry, empty collections, PII/tenant exclusion, and frozen pages; current source deletion and tombstone retention; recording-gap detection and explicit repair; real independent-connection `SKIP LOCKED`, nonce uniqueness, code single-winner redemption, source commit visibility, and export serialization while security writes proceed. Actual SQL Manifest/Page/Event objects were parsed with the coordinator's shared TypeScript wire schemas.

The `pg_net` queue tests use a typed SQL stand-in because the isolated plain PostgreSQL image lacks that extension; real HTTP delivery, Vercel cron timing, live two-app browser SSO, production load/SLOs, target application, and deployment remain integration/deployment work. No full application build was run by this worker.

The pinned Supabase CLI security advisor was attempted against this localhost fixture, both with its default connection settings and explicit `sslmode=disable`; both failed because the CLI attempted TLS against the non-TLS Docker fixture. The executed PostgreSQL ACL/RLS/function-grant assertions passed, but a successful Supabase advisor result is not claimed.

References checked: [Supabase functions/security grants](https://supabase.com/docs/guides/database/functions), [pg_net signatures and post-commit dispatch](https://supabase.com/docs/guides/database/extensions/pg_net), and the current Supabase changelog. Native PostgreSQL SHA-256 avoids an additional extension dependency.
