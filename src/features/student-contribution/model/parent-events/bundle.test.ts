import { expect, it } from "vitest";
import { buildEventBundle as buildPrivateBundle, normalizedGrid, type EventSourcePack } from "../../../../../scripts/student-contribution/parent-events/bundle";
import { hash } from "../../../../../scripts/student-contribution/parent-events/source-values";
import type { EventDatabaseSnapshot } from "../../../../../scripts/student-contribution/parent-events/snapshot";
import { verifySourceSnapshot } from "../../../../../scripts/student-contribution/parent-events/source-freshness";
const buildEventBundle = (database: EventDatabaseSnapshot, pack: EventSourcePack, today: string) => buildPrivateBundle(database, pack, today, "synthetic-key-for-local-tests-only");
const database: EventDatabaseSnapshot = { tenantId: "t", students: [{ id: "s", tenant_id: "t", name: "가학생", parent_name: "가보호",
  parent_phone: "01023456789", student_phone: null, school: "가초", grade: "초4", status: "enrolled", notes: null, is_test: false, enrolled_at: "2024-01-01", withdrawn_at: null, withdrawal_metadata: null }], siblings: [], enrollments: [], settings: [{ revision: 0, config: {} }] };
const header = ["학생", "전화", "취소"];
const pack: EventSourcePack = { capturedAt: "2026-10-26T00:00:00Z", sources: [{ fileId: "file", title: "설명회", sheet: "신청", gid: 1,
  url: "https://docs.google.com/spreadsheets/d/file/edit", values: [header, ["가학생", "01023456789", "FALSE"]] }], profiles: [{ fileId: "file", sheet: "신청", gid: 1,
  blocks: [{ start: 0, end: 3, firstRow: 1, headerRow: 0, headerHash: hash(header), eventKey: "event", title: "설명회", date: "2025-01-01", tenantId: "t", eligibleList: true, issues: [], name: 0, phone: 1, markers: [{ column: 2, kind: "cancellation" }] }] }] };
it("reproduces the approved fingerprint and changes it for source, identity, policy inputs and cancellation", () => {
  const bundle = buildEventBundle(database, pack, "2026-10-26");
  expect(bundle.summary.studentEvents).toBe(1); expect(bundle.summary.enabled).toBe(false);
  expect(bundle.events[0]!.id).toMatch(/^[a-f0-9]{64}$/);
  expect(bundle.credits[0]!.eventId).not.toContain("file");
  expect(buildPrivateBundle(database, pack, "2026-10-26", "a-different-private-key-for-testing").events[0]!.id).not.toBe(bundle.events[0]!.id);
  expect(buildEventBundle(database, structuredClone(pack), "2026-10-26").fingerprint).toBe(bundle.fingerprint);
  const changed = structuredClone(pack); changed.sources[0]!.values[1]![2] = "취소";
  const cancelled = buildEventBundle(database, changed, "2026-10-26");
  expect(cancelled.fingerprint).not.toBe(bundle.fingerprint); expect(cancelled.credits).toEqual([]);
  expect(buildEventBundle({ ...database, settings: [{ revision: 1, config: {} }] }, pack, "2026-10-26").fingerprint).not.toBe(bundle.fingerprint);
  expect(() => buildEventBundle({ ...database, tenantId: "other" }, pack, "2026-10-26")).toThrow("Cross-tenant");
  expect(normalizedGrid([[true, 3, null], ["", ""]])).toEqual([["TRUE", "3"]]);
});
it("requires complete current-day Drive reads before producing an approval report", () => {
  expect(verifySourceSnapshot(pack, pack, "2026-10-26")).toBe(pack.capturedAt);
  expect(() => verifySourceSnapshot(pack, pack, "2026-10-27")).toThrow("Current-day");
  expect(() => verifySourceSnapshot(pack, { ...pack, sources: [] }, "2026-10-26")).toThrow("Incomplete");
  const changed = structuredClone(pack); changed.sources[0]!.values[1]![2] = "취소";
  expect(() => verifySourceSnapshot(pack, changed, "2026-10-26")).toThrow("changed");
});
it("reports only this academy's relevant unresolved rows and keeps a private-key version for future imports", () => {
  const pending = structuredClone(pack);
  pending.sources[0]!.values.push(["미확인", "01023456780", "FALSE"]);
  const bundle = buildEventBundle(database, pending, "2026-10-26");
  expect(bundle.summary.pendingRows).toBe(1);
  expect(bundle.summary.identityKeyFingerprint).toMatch(/^[a-f0-9]{16}$/);
  pending.profiles[0]!.blocks[0]!.tenantId = null;
  expect(buildEventBundle(database, pending, "2026-10-26").summary.pendingRows).toBe(0);
});
it("refuses overlapping source/household layouts instead of dropping extra family keys", () => {
  expect(() => buildEventBundle(database, { ...pack, sources: [...pack.sources, pack.sources[0]!] }, "2026-10-26")).toThrow("Incomplete");
  const moved = structuredClone(pack); moved.sources[0]!.values.splice(1, 0, []);
  const before = buildEventBundle(database, pack, "2026-10-26"), after = buildEventBundle(database, moved, "2026-10-26");
  expect(before.registrations[0]!.sourceId).toBe(after.registrations[0]!.sourceId);
  expect(before.fingerprint).not.toBe(after.fingerprint);
});
