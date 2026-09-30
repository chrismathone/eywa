import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYNC_COOLDOWN_MIN,
  SYNC_PENDING_STALE_MIN,
  SYNC_RUNNING_STALE_MIN,
  cooldownLeftMs,
  deriveSyncView,
  mergeScope,
  normalizeScope,
  sameScope,
  staleReason,
  syncResultBrief,
  toSyncRow,
  workerReadyFromHeartbeats,
  type SyncRequestRow,
} from "./classnote-sync";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-09-30T05:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const row = (p: Partial<SyncRequestRow>): SyncRequestRow => ({
  id: "r1",
  status: "pending",
  requestedAt: ago(1),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  scope: { full: true, classIds: [], studentIds: [] },
  mergeCount: 0,
  nextScope: null,
  ...p,
});

describe("범위 — 비면 전체, 합치면 합집합", () => {
  it("반·학생이 없으면 전체(차이 계산), uuid가 아닌 값은 버린다", () => {
    expect(normalizeScope(undefined)).toEqual({ full: true, classIds: [], studentIds: [] });
    expect(normalizeScope({ classIds: [A, "x", A], studentIds: ["'; drop"] })).toEqual({ full: false, classIds: [A], studentIds: [] });
  });
  it("대기 중 전체 + 지목 = 전체 유지 + 지목 합침 · 같은 범위는 안 바뀜", () => {
    const m = mergeScope(normalizeScope({}), normalizeScope({ classIds: [A] }));
    expect(m.full).toBe(true);
    expect(m.classIds).toEqual([A]);
    const s = normalizeScope({ classIds: [A, B] });
    expect(sameScope(mergeScope(s, normalizeScope({ classIds: [B] })), s)).toBe(true);
  });
  it("상한 50개", () => {
    const many = Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(normalizeScope({ classIds: many }).classIds).toHaveLength(50);
  });
});

describe("멈춘 요청 · 쿨다운", () => {
  it(`대기 ${SYNC_PENDING_STALE_MIN}분 초과 = 연동 PC 꺼짐, 실행 ${SYNC_RUNNING_STALE_MIN}분 초과 = 시간 초과`, () => {
    expect(staleReason(row({ requestedAt: ago(SYNC_PENDING_STALE_MIN - 1) }), NOW)).toBeNull();
    expect(staleReason(row({ requestedAt: ago(SYNC_PENDING_STALE_MIN + 1) }), NOW)).toMatch(/연동 PC/);
    expect(staleReason(row({ status: "running", requestedAt: ago(60), startedAt: ago(5) }), NOW)).toBeNull();
    expect(staleReason(row({ status: "running", startedAt: ago(SYNC_RUNNING_STALE_MIN + 1) }), NOW)).toMatch(/시간 초과/);
  });
  it(`끝난 뒤 ${SYNC_COOLDOWN_MIN}분 쿨다운 — 시간 초과로 끝난 요청엔 걸지 않는다`, () => {
    expect(cooldownLeftMs(row({ status: "done", finishedAt: ago(1) }), NOW)).toBe((SYNC_COOLDOWN_MIN - 1) * 60_000);
    expect(cooldownLeftMs(row({ status: "done", finishedAt: ago(SYNC_COOLDOWN_MIN + 1) }), NOW)).toBe(0);
    expect(cooldownLeftMs(row({ status: "failed", finishedAt: ago(1), result: { timedOut: true } }), NOW)).toBe(0);
    expect(cooldownLeftMs(null, NOW)).toBe(0);
  });
});

describe("버튼 상태", () => {
  const base = { available: true, workerReady: true, active: null, latest: null, nowMs: NOW };
  it("숨김 — 모듈 꺼짐·SQL 전·권한 없음(available=false)", () => {
    expect(deriveSyncView({ ...base, available: false }).kind).toBe("hidden");
  });
  it("대기 → 요청됨, 실행 → 동기화 중", () => {
    expect(deriveSyncView({ ...base, active: row({}) }).kind).toBe("pending");
    expect(deriveSyncView({ ...base, active: row({ status: "running", startedAt: ago(1) }) }).kind).toBe("running");
  });
  it("멈춘 요청은 실패로 보이고 바로 다시 누를 수 있다", () => {
    const v = deriveSyncView({ ...base, active: row({ requestedAt: ago(40) }) });
    expect(v).toMatchObject({ kind: "failed", leftMin: 0 });
  });
  it("완료 직후 = 쿨다운(마지막 결과 요약) · 지나면 idle", () => {
    const done = row({ status: "done", finishedAt: ago(2), result: { classes: 3, enrolled: 2, summary: "반 3개 확인" } });
    const v = deriveSyncView({ ...base, latest: done });
    expect(v).toMatchObject({ kind: "cooldown", leftMin: 3 });
    expect(v.kind === "cooldown" && v.last).toMatch(/마지막 동기화 \d{2}:\d{2} · 반 3 · 배정 2/);
    expect(deriveSyncView({ ...base, latest: { ...done, finishedAt: ago(10) } }).kind).toBe("idle");
  });
  it("워커 실패 = 한글 사유 + 원문은 따로(툴팁)", () => {
    const f = row({ status: "failed", finishedAt: ago(1), error: "ClassNote 로그인에 실패했습니다", result: { raw: "Error: login 401" } });
    expect(deriveSyncView({ ...base, latest: f })).toMatchObject({ kind: "failed", reason: "ClassNote 로그인에 실패했습니다", raw: "Error: login 401" });
  });
  it("연동 PC 꺼짐·옛 버전 = 누를 수 없음(사유 표시)", () => {
    expect(deriveSyncView({ ...base, workerReady: false }).kind).toBe("offline");
  });
  it("결과 요약 — 변경 없음 / 숫자만", () => {
    expect(syncResultBrief({ noChange: true })).toBe("변경 없음");
    expect(syncResultBrief({ classes: 2, enrolled: 0, held: 1 })).toBe("반 2 · 배정 0 · 보류 1");
  });
});

describe("연동 PC 준비 — 살아 있고 · 실게시 · 이 기능을 아는 버전", () => {
  const hb = (min: number, lr: unknown) => ({ last_seen: ago(min), last_results: lr });
  it("세 조건을 모두 만족하는 PC가 하나라도 있으면 true", () => {
    expect(workerReadyFromHeartbeats([hb(1, { postMode: true, caps: { syncRequests: true } })], NOW)).toBe(true);
  });
  it("옛 워커(caps 없음)·dry-run PC·오래된 심장박동은 false", () => {
    expect(workerReadyFromHeartbeats([hb(1, { postMode: true, caps: { classBoardSync: true } })], NOW)).toBe(false);
    expect(workerReadyFromHeartbeats([hb(1, { postMode: false, caps: { syncRequests: true } })], NOW)).toBe(false);
    expect(workerReadyFromHeartbeats([hb(30, { postMode: true, caps: { syncRequests: true } })], NOW)).toBe(false);
    expect(workerReadyFromHeartbeats([], NOW)).toBe(false);
  });
  it("모르는 상태 행은 버린다", () => {
    expect(toSyncRow({ id: "x", status: "queued", requested_at: ago(1) })).toBeNull();
  });
});

describe("🔴 앱·워커 숫자 일치(다른 런타임이라 두 벌)", () => {
  it("멈춤 기준 분이 워커 sync-request-plan.mjs와 같다", () => {
    const src = readFileSync(join(process.cwd(), "scripts/_classnote/sync-request-plan.mjs"), "utf8");
    expect(src).toContain(`export const PENDING_STALE_MIN = ${SYNC_PENDING_STALE_MIN};`);
    expect(src).toContain(`export const RUNNING_STALE_MIN = ${SYNC_RUNNING_STALE_MIN};`);
  });
});
