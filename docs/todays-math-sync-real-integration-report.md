# Source → target real PostgreSQL integration verification

2026-10-03. Coordinator final rerun after automatic onboarding: **16 integration groups passed**, process exit 0, against PostgreSQL 17.11 in the local Docker fixture. The prior export-size audit exposed a real SQL response-size defect; it was reproduced, fixed in the owned source migration, and verified with a failing-before/passing-after SQL regression. The final added group uses the actual source license trigger and target automatic provisioning, rather than a pre-created branch.

## Reproduce

Harness in the target checkout: `scripts/qa/eywa-source-target-integration.ts`.

From `C:/Users/user/orca/workspaces/testautocreator/eywa-managed-sync`:

```powershell
node --conditions=react-server --import tsx scripts/qa/eywa-source-target-integration.ts --source-root C:/Users/user/orca/workspaces/eywa/eywa-sync-today-math
```

Prerequisites: existing PostgreSQL at `127.0.0.1:55432`, local `postgres` fixture role, databases `eywa_e2e_source` and `eywa_e2e_target`, installed dependencies in both checkouts, and the target Prisma client generated from its current schema. These two dedicated databases were created for this task. The harness checks their exact names and resets only their schemas; it never accepts a connection URL. It leaves the resulting fixture data available for inspection. The owners' `eywa_source_test` and `eywa_target_test` databases are untouched.

The target baseline is generated with the installed Prisma CLI from predecessor commit `d65f042002eebb7ba04d6df97d9da6891c7d9171:prisma/schema.prisma`, then the complete `20261003085222_eywa_managed_sync` and `20261003103000_eywa_auto_branch` migrations are applied, including SQL guards. This pinned predecessor keeps the test reproducible after the new implementation is committed. The source uses its actual predecessor migrations and `supabase/migrations/s1_season1.sql#0337a_todays_math_sync_v2.sql`; only Supabase Auth's local fixture schema is minimal.

No live credentials, environment files, deployment, cloud branches, or application build were used. DATABASE_URL/DIRECT_URL and fixture signing configuration are assigned within the test process before loading Prisma. The generated schema file is an isolated temporary file, removed after migration generation.

## Executed path

Actual source business writes → transactional trigger/outbox → `tm_sync_claim_events` as **service_role** → real shared HMAC signing → local HTTP → target `verifyReceiverRequest` and `receiveEvent` → durable inbox/lease → actual `processBinding` → signed HTTP source control/snapshot RPCs → target `reconcileManagedAccounts`, `applyManagedControl`, `applyEywaRelations` → real target class access queries.

SSO uses actual target `beginSso`, actual source `tm_sync_issue_code` and atomic `tm_sync_exchange_code`, the shared signed assertion, then real target `exchangeSso` and `authorizeManagedSso`. Transport alone is adapted through two local Node HTTP servers. The source adapter dispatches to real service-role SQL RPCs, and the target adapter calls actual receiver/authentication helpers. Business implementations and database clients are not mocked. Source and target wire-contract files are asserted byte-identical.

## Passing groups

1. Actual source migrations and target baseline plus complete managed migration apply on isolated databases.
2. Real signed outbox delivery provisions a teacher with no password, no administration flags, branch teacher role, and exactly home/teaching/concept menus; English-only, pending, protected recovery identities, and test students are excluded.
3. Existing email/name candidates remain byte-for-byte unchanged until successful owner password approval; existing credentials remain after approval. A name mismatch stays in conflict and operator approval cannot bypass it.
4. Actual class queries enforce current teacher and read-only delegate access. Past pending handover does not silently move the class. A single student identity can appear in two class rosters; held/future/test enrollments are excluded operationally; normal end dates are inclusive and transfer end dates exclusive. Held students remain visible when explicitly included.
5. Actual frozen pages preserve exact JSON-string SHA256 through HTTP and strict typed complete-snapshot validation. Parent phone fixture sentinel is absent from exports.
6. Actual source PKCE code produces an accepted target login; source code, callback, and target assertion-ticket replays fail.
7. An incorrect PKCE verifier cannot redeem the code; the legitimate verifier still succeeds afterward.
8. Unsigned delivery is rejected, exact event retries are idempotent, changed payload under the same event ID is rejected, and a replayed signed processing nonce is rejected by the database.
9. OFF control remains readable. When the target never observes intermediate OFF, the next ON control still advances revocation generation, increases the target session version, and rejects an outstanding old SSO assertion.
10. Retirement/rejoin and Auth ban/unban revoke and restore eligibility. Source recovery does not clear an explicit target manual suspension.
11. A class teacher change denies the old teacher before roster synchronization; the new teacher remains denied until matching class revision/membership arrives. Expired delegation is denied through fresh control.
12. An unavailable snapshot page leaves content generation and roster unchanged. Independent OFF control still commits and blocks access; complete retry subsequently applies the content update.
13. A deliberately delayed older signed control cannot lower the stored security revision or revive a retired teacher.
14. An actual source tenant transfer creates a conflict without automatic target reassignment. Explicit independently evidenced operator approval switches the managed identity; old classes/students retain their original branch, old class access is denied, old-binding OFF does not affect the new mapping, and SSO works from the new source binding.
15. A new tenant starts OFF, with neither a source binding nor a target branch. After installation opt-in, the actual license ON trigger creates the source binding/outbox. Signed delivery creates the target branch, managed teacher, class, and student. OFF denies login while preserving roster records. ON and a source name change reuse the same branch creation timestamp, teacher ID, and records, and update the auto-owned branch name. The independent byte fixture then disables installation onboarding so its explicit test mapping is not preempted by the automatic trigger.
16. A quote/backslash-heavy progress row produced an inner JSON string below the old 1.5 MB bound but a complete Page response above 2.4 MB. The corrected SQL counts the complete serialized Page against 2 MiB, preserves the exact inner-string hash, and also bounds the Manifest. Real SQL accepts a roughly 2.08 MB Page, rejects the oversized case without advancing generation or leaving a manifest/partial pages, preserves the previous frozen page, and round-trips UTF-8/control characters. This regression is `supabase/tests/todays_math_sync_page_bytes.sql`, called by both the source SQL runner and this integration harness.

The final run observed 45 control, 12 snapshot, 55 page, and 6 token HTTP calls. Call counts can vary with retry timing; assertions concern persisted state and access decisions. Prisma prints expected unique-constraint errors during deliberate event/nonce replay tests; these are caught and their rejection is asserted.

## Additional verification and limits

- Dedicated harness ESLint passed with exit 0. Prettier formatted only that file.
- Focused TypeScript program rooted at this harness and its real imported modules returned **0 diagnostics**; no whole application build was run.
- The first complete run passed 13 groups; later runs added wrong-PKCE recovery, explicit minimum menu assertion, and the serialized Page byte regression. The final 15-group run passed after the SQL fix.
- This verifies local SQL, signed HTTP contracts, receiver state, SSO authorization, and relational access. It does **not** claim browser routing/cookies, Auth.js session-cookie issuance, real user source-login interaction, production latency, cron scheduling, pg_net wake delivery, or production deployment evidence.
- The original two explicit bindings are seeded active for integration setup; source shadow→active uses its real configure RPC. The added automatic tenant has no seeded target branch or binding. The operator UI activation flow is outside this harness.
- Source results reverse synchronization remains future work and was not added.
- No blocker remains for this verification task. Live migration application, environment setup, and deployment remain with the coordinator/user.
