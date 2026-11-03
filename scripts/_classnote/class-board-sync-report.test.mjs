// 반 보드 동기화 보고서(0329a, 원장 2026-10-02) — 줄 만들기 · 회차 기록 · 감사로그(어떤 기록 실패도 동기화를 막지 않는다).
import { describe, it, expect } from "vitest";
import {
  appliedEvents,
  auditDailyRun,
  auditEnrollments,
  planEvents,
  releaseEvents,
  stoppedEvents,
  summarizeEvents,
  teacherEvents,
  writeSyncRun,
} from "./class-board-sync-report.mjs";

/** postgres.js 흉내 — 태그드 템플릿 호출을 모으고, `sql.json`은 값을 그대로 감싼다. */
// ⚠️ 계획의 보드 종류는 `["action"]`으로 적는다 — 감사로그 레지스트리 가드가 audit_logs를 언급하는 scripts 파일의 `action: "…"`을 액션 키로 읽는다.
function fakeSql({ fail = false } = {}) {
  const calls = [];
  const sql = (strings, ...values) => {
    if (fail) return Promise.reject(new Error('relation "classnote_board_sync_runs" does not exist'));
    calls.push({ text: strings.join("?").replace(/\s+/g, " "), values });
    return Promise.resolve([]);
  };
  sql.json = (v) => ({ json: v });
  return { sql, calls };
}

describe("줄 만들기 — 이유까지 한글 한 줄로", () => {
  it("계획: 반 보드를 못 정한 반 · 이름 변경 보류 · 학생별 보류 사유 전부", () => {
    const lines = planEvents([
      { className: "가반", board: { ["action"]: "block", reason: "같은 이름 보드가 2개" }, hold: [] },
      { className: "나반", board: { ["action"]: "exists", id: 1, renameBlocked: "새 이름을 다른 보드가 쓰고 있다" }, hold: [{ name: "박도윤", reasons: ["학부모 미가입", "1인 보드 없음"] }] },
      { className: "다반", board: { ["action"]: "exists", id: 2 }, hold: [] },
    ]);
    expect(lines).toEqual([
      { group: "failed", className: "가반", text: "반 보드를 정하지 못했습니다 — 같은 이름 보드가 2개" },
      { group: "failed", className: "나반", text: "반 이름 변경 보류 — 새 이름을 다른 보드가 쓰고 있다" },
      { group: "held", className: "나반", text: "박도윤: 학부모 미가입 / 1인 보드 없음", name: "박도윤" },
    ]);
  });
  it("🔴 학생이 없어 일부러 안 만든 보고서 미발송(JJ) 반은 '실패'가 아니라 '보류' 안내 — 실패 수·버튼 숫자에 안 든다(리뷰 C1)", () => {
    const lines = planEvents([{ className: "주말 내신 특강", board: { ["action"]: "block", reason: "학생 없음", notice: true }, hold: [] }]);
    expect(lines).toEqual([{ group: "held", className: "주말 내신 특강", text: "반 보드를 만들지 않았습니다 — 학생 없음" }]);
    expect(summarizeEvents(lines).failed).toBe(0);
  });
  it("실행: 반 생성·이름 변경·원아 배정은 변동, 이름 변경 실패·그 반만 보류는 실패", () => {
    const lines = appliedEvents([
      { className: "가반", created: true, renamed: null, enrolled: [{ name: "김민준", childId: 1 }], skipped: null },
      { className: "새 이름", created: false, renamed: "옛 이름", enrolled: [], skipped: null },
      { className: "다반", created: false, renamed: null, renameFailed: "HTTP 400", enrolled: [], skipped: "반 생성 실패 — 새 보드 없음" },
    ]);
    expect(lines.map((l) => `${l.group}|${l.className}|${l.text}`)).toEqual([
      "changed|가반|ClassNote 반 보드를 새로 만들었습니다",
      "changed|가반|원아 배정: 김민준",
      'changed|새 이름|반 이름 변경: "옛 이름" → "새 이름"',
      "failed|다반|반 이름 변경 실패 — HTTP 400",
      "failed|다반|반 생성 실패 — 새 보드 없음",
    ]);
  });
  it("담임: 연결한 것은 변동, 건너뛴 것은 보류(반 이름을 앞에서 떼어 낸다)", () => {
    expect(teacherEvents([{ className: "가반", teacher: "이수진" }], ["나반: 담임 없음", "모양이 다른 사유"])).toEqual([
      { group: "changed", className: "가반", text: "담임 연결: 이수진" },
      { group: "held", className: "나반", text: "담임 연결 안 함 — 담임 없음" },
      { group: "held", className: "", text: "담임 연결 안 함 — 모양이 다른 사유" },
    ]);
  });
  it("해제 대상: 보드가 확인된 반의 잉여 원아만", () => {
    expect(releaseEvents([
      { className: "가반", board: { ["action"]: "exists", id: 1 }, extras: ["이서연", "최하린"] },
      { className: "나반", board: { ["action"]: "create" }, extras: ["x"] },
      { className: "다반", board: { ["action"]: "exists", id: 2 }, extras: [] },
    ])).toEqual([{ group: "release", className: "가반", text: "해제 필요: 이서연, 최하린" }]);
  });
  it("🔴 멈춘 회차 — 반·학생이 적힌 한글 원문은 그대로 실패 줄로, 손대지 못한 반은 보류 줄로(영문 오류 원문은 싣지 않는다)", () => {
    const targets = [{ classId: "c1", className: "가반" }, { classId: "c2", className: "나반" }, { classId: "c3", className: "다반" }];
    const applied = [{ classId: "c1", className: "가반" }, { classId: "c2", className: "나반" }]; // 나반에서 멈췄다(결과 줄은 만들어진 상태)
    expect(stoppedEvents(new Error("홍길동: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단"), targets, applied)).toEqual([
      { group: "failed", className: "", text: "여기서 멈췄습니다 — 홍길동: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단" },
      { group: "held", className: "다반", text: "앞에서 멈춰 이번에는 하지 못했습니다 — 다음 동기화에서 다시 합니다" },
    ]);
    expect(stoppedEvents(new Error("page.goto: net::ERR_CONNECTION_RESET"), targets, targets)).toEqual([]);
  });
  it("요약 숫자는 줄에서 센다", () => {
    expect(summarizeEvents([{ group: "changed" }, { group: "changed" }, { group: "held" }], { classes: 3 }))
      .toEqual({ changed: 2, failed: 0, held: 1, release: 0, classes: 3 });
  });
});

describe("회차 기록", () => {
  it("성공·멈춤 모두 한 줄 — 줄과 요약은 sql.json으로(문자열로 넣으면 이중 인코딩)", async () => {
    const { sql, calls } = fakeSql();
    const startedAt = new Date("2026-10-01T20:00:00Z");
    const events = [{ group: "changed", className: "가반", text: "원아 배정: 김민준" }];
    expect(await writeSyncRun(sql, { tenant: "t1", kind: "request", requestId: "r1", startedAt, ok: false, error: "멈춤", events, summary: { classes: 1 } })).toBe(true);
    expect(calls).toHaveLength(2); // 회차 1행 + 석 달 지난 회차 정리
    expect(calls[0].text).toContain("insert into classnote_board_sync_runs");
    expect(calls[1].text).toContain("delete from classnote_board_sync_runs");
    expect(calls[0].values).toEqual(["t1", "request", "r1", startedAt, false, "멈춤",
      { json: { changed: 1, failed: 0, held: 0, release: 0, classes: 1, truncated: false } }, { json: events }]);
  });
  it("줄이 2,000개를 넘으면 잘라 적고 잘렸다고 남긴다(요약 숫자는 전체 기준)", async () => {
    const { sql, calls } = fakeSql();
    const events = Array.from({ length: 2100 }, (_, i) => ({ group: "held", className: "가반", text: `학생${i}: 사유` }));
    await writeSyncRun(sql, { tenant: "t1", kind: "daily", startedAt: new Date(), ok: true, events });
    expect(calls[0].values[7].json).toHaveLength(2000);
    expect(calls[0].values[6].json).toMatchObject({ held: 2100, truncated: true });
  });
  it("표가 아직 없으면(0329a 전) 그 기록만 건너뛴다 — 던지지 않는다", async () => {
    const { sql } = fakeSql({ fail: true });
    const logs = [];
    expect(await writeSyncRun(sql, { tenant: "t1", kind: "daily", startedAt: new Date(), ok: true, events: [], log: (l) => logs.push(l) })).toBe(false);
    expect(logs[0]).toContain("동기화 보고서 기록 건너뜀");
  });
});

describe("감사로그 — 학생 기록에도 남긴다", () => {
  it("배정한 원아마다 한 줄(학생·반·보드·원아) · 실패해도 던지지 않는다", async () => {
    const { sql, calls } = fakeSql();
    await auditEnrollments(sql, "t1", [
      { className: "가반", boardId: 111, enrolled: [{ name: "김민준", childId: 5, studentId: "s1" }, { name: "이서연", childId: 6, studentId: "s2" }] },
      { className: "나반", boardId: 222, enrolled: [] },
    ], { kind: "daily" });
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain("insert into audit_logs");
    expect(calls[0].values).toEqual(["t1", "system:classnote-board-sync", "classnote_board_enroll", "student", "김민준",
      { json: { studentId: "s1", className: "가반", boardId: 111, childId: 5, kind: "daily" } }]);
    const broken = fakeSql({ fail: true });
    await expect(auditEnrollments(broken.sql, "t1", [{ className: "가반", enrolled: [{ name: "김민준" }] }], { kind: "request" })).resolves.toBeUndefined();
  });
  it("매일 정기 동기화 한 회차 — 성공·멈춤을 라벨로 가른다", async () => {
    const { sql, calls } = fakeSql();
    await auditDailyRun(sql, "t1", { ok: false, error: "멈춤", summary: { changed: 1 } });
    expect(calls[0].values).toEqual(["t1", "system:classnote-board-sync", "classnote_board_sync_daily", "classnote_sync", "반 보드 정기 동기화 실패",
      { json: { ok: false, changed: 1, error: "멈춤" } }]);
  });
});
