import { describe, expect, it, vi } from "vitest";
import { encodeTip } from "@/components/hover-tip/tip";
import { REPORT_OPTOUT_NOTICE } from "@/features/classes/report-optout";
import {
  isUnsentListRow,
  maskPhoneLike,
  unsentReasonCard,
  UNSENT_EXPIRED,
  UNSENT_MAKEUP_BOARD,
  UNSENT_NOT_PRESSED,
  UNSENT_SEND_OFF,
  type UnsentReasonFacts,
} from "./unsent-reason";

const { settings } = vi.hoisted(() => ({
  settings: {
    modules: { disabled: [] as string[] },
    report: { classnoteSendEnabled: true, classnoteSubjects: ["math"] },
    operations: { subjects: [{ key: "math", label: "수학", color: "blue" }] },
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-11-04" }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => settings }));
// 보강 확인 묶음 판정(관리자 일괄 발송과 같은 함수) — 여기서는 id 목록으로 흉내 낸다(실제는 보강 예약 표를 읽는다).
const { makeupPending } = vi.hoisted(() => ({ makeupPending: new Set<string>() }));
vi.mock("@/features/attendance/server/makeup-check-gate", () => ({
  makeupUncheckedIds: async (_tenant: string, rows: readonly { id: unknown; makeup: unknown }[]) =>
    new Set(rows.filter((r) => r.makeup && makeupPending.has(String(r.id))).map((r) => String(r.id))),
}));

const HOLD = '원아 "전유솔" 보호자 전화 불일치';
const base: UnsentReasonFacts = {
  reportDate: "2026-11-03",
  today: "2026-11-04",
  deadlineExempt: false,
  sendOn: true,
  subjectOk: true,
  subjectLabel: "수학",
  gate: {
    reportOptout: false,
    isAbsent: false,
    hasProgress: true,
    hasMent: true,
    attendanceUnchecked: false,
    needsAutoWrite: false,
    needsMakeupCheck: false,
  },
  board: null,
};
const text = (card: ReturnType<typeof unsentReasonCard>) => JSON.stringify(card);

describe("보고서 목록 '미발송' 칸 카드 — 아직 안 나간 이유(원장 2026-11-04)", () => {
  it("목록의 '미발송' = 발송 이력 없음 + 이관분 아님", () => {
    expect(isUnsentListRow({ classnoteStatus: null, source: "onescreen" })).toBe(true);
    expect(isUnsentListRow({ classnoteStatus: null, source: null })).toBe(true);
    expect(isUnsentListRow({ classnoteStatus: null, source: "edutrix_import" })).toBe(false);
    expect(isUnsentListRow({ classnoteStatus: "failed", source: "onescreen" })).toBe(false);
  });

  it("🔴 전유솔 사례 — 반 보드 배정 보류면 보류 사유를 그대로, 원스크린 발송 막힘 안내와 같은 문장", () => {
    const card = unsentReasonCard({ ...base, board: { kind: "hold_other", holdReason: HOLD, makeup: false } });
    expect(card.rows).toContainEqual(["반 보드", "배정 보류"]);
    expect(card.rows).toContainEqual(["보류 사유", HOLD]);
    expect(card.lines?.some((l) => typeof l === "string" && l.includes("관리자 확인이 필요합니다"))).toBe(true);
    expect(card.lines).not.toContain(UNSENT_NOT_PRESSED);
    expect(encodeTip(card)).toBeTruthy(); // 카드가 실제로 그려진다(빈 카드 아님)
  });

  it("🔴 보호자 전화 값은 싣지 않는다 — 사유에 번호가 섞여 들어와도 가린다", () => {
    const card = unsentReasonCard({ ...base, board: { kind: "hold_other", holdReason: "보호자 전화 010-1234-5678 불일치", makeup: false } });
    expect(text(card)).not.toMatch(/1234|5678/);
    expect(maskPhoneLike("연락 01012345678 확인")).toBe("연락 (번호 가림) 확인");
    expect(maskPhoneLike("11/9까지 · 7일")).toBe("11/9까지 · 7일");
  });

  it("반 보드 연결 없음·배정 전·반을 떠남도 한글 상태로", () => {
    expect(unsentReasonCard({ ...base, board: { kind: "class_pending", holdReason: null, makeup: false } }).rows).toContainEqual(["반 보드", "연결 없음"]);
    expect(unsentReasonCard({ ...base, board: { kind: "enrolling", holdReason: null, makeup: false } }).rows).toContainEqual(["반 보드", "배정 전"]);
    expect(unsentReasonCard({ ...base, board: { kind: "left", holdReason: null, makeup: false } }).rows).toContainEqual(["반 보드", "반을 떠남"]);
  });

  it("🔴 미발송 반 — 같은 문장(report-optout.ts) · 반 보드 안내는 덧붙이지 않는다(대상이 아니다)", () => {
    const card = unsentReasonCard({ ...base, gate: { ...base.gate, reportOptout: true }, board: { kind: "unknown", holdReason: null, makeup: false } });
    expect(card.lines).toContain(REPORT_OPTOUT_NOTICE);
    expect(card.rows?.some((r) => r && r[0] === "반 보드")).toBe(false);
  });

  it("발송 기한 지남 · 실제 발송 꺼짐 · 과목 미허용 · 결석 · 입력 부족", () => {
    const expired = unsentReasonCard({ ...base, reportDate: "2026-10-20" });
    expect(expired.rows).toContainEqual(["발송 기한", "기한 만료"]);
    expect(expired.lines).toContain(UNSENT_EXPIRED);
    // 원장 지정 예외(0276a)는 기한이 지나도 보낸다.
    const exempt = unsentReasonCard({ ...base, reportDate: "2026-10-20", deadlineExempt: true });
    expect(exempt.lines).not.toContain(UNSENT_EXPIRED);
    expect(unsentReasonCard({ ...base, sendOn: false }).lines).toContain(UNSENT_SEND_OFF);
    expect(text(unsentReasonCard({ ...base, subjectOk: false, subjectLabel: "영어" }))).toContain("영어 — 저장했지만 이 과목은 발송 대상이 아니라");
    expect(text(unsentReasonCard({ ...base, gate: { ...base.gate, isAbsent: true } }))).toContain("결석 학생 — 발송 제외");
    const needs = unsentReasonCard({ ...base, gate: { ...base.gate, hasMent: false, attendanceUnchecked: true } });
    expect(text(needs)).toContain("출결이 아직 체크되지 않았습니다");
    expect(text(needs)).toContain("학부모 전달 멘트가 비어 있습니다");
    expect(needs.lines).not.toContain(UNSENT_NOT_PRESSED);
  });

  it("아무것도 안 걸리면 단정하지 않는 문장 — 저장되지 않는 원스크린 작성 조건이 남았을 수 있다 · 기한은 남은 날로", () => {
    const card = unsentReasonCard(base);
    expect(card.lines).toEqual([UNSENT_NOT_PRESSED]);
    expect(UNSENT_NOT_PRESSED).toContain("수 있습니다");
    expect(card.rows).toEqual([["발송 기한", "11/9까지"]]);
    expect(unsentReasonCard({ ...base, reportDate: "2026-10-29" }).rows).toEqual([["발송 기한", "오늘까지"]]);
  });

  // 리뷰 2026-11-04: 원스크린 버튼이 잠긴 줄인데 카드가 "아직 누르지 않았다"고 하던 것 — 서버가 볼 수 있는 조건은 같은 판정으로 싣는다.
  it("새 수학 보고서인데 자동작성 글이 아니면 · 보강 확인 전이면 — 원스크린 게이트와 같은 안내", () => {
    const auto = unsentReasonCard({ ...base, gate: { ...base.gate, needsAutoWrite: true } });
    expect(text(auto)).toContain("'자동작성'으로 만든 글만 보낼 수 있습니다");
    expect(auto.lines).not.toContain(UNSENT_NOT_PRESSED);
    const mk = unsentReasonCard({ ...base, gate: { ...base.gate, needsMakeupCheck: true } });
    expect(text(mk)).toContain("보강 예약이 든 보고서입니다");
    expect(mk.lines).not.toContain(UNSENT_NOT_PRESSED);
  });

  it("보강 보고서의 반 보드가 없으면 '보강 반을 바꿔야' — 정규 보고서의 '다른 반으로 보내지 않는다'가 아니다", () => {
    const card = unsentReasonCard({ ...base, board: { kind: "class_pending", holdReason: null, makeup: true } });
    expect(card.lines).toContain(UNSENT_MAKEUP_BOARD);
    expect(text(card)).not.toContain("다른 반으로");
  });

  it("🔴 화면에 원문 영어 코드(상태·판정 키)를 싣지 않는다", () => {
    const card = unsentReasonCard({ ...base, board: { kind: "hold_join", holdReason: "ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음", makeup: false } });
    expect(text(card)).not.toMatch(/hold_join|hold_other|board_|enrolling|class_pending|report_optout/);
  });
});

/** 표 이름 → 행. eq·in·is만 걸러 주고 or·order는 그대로(이관분은 넣지 않는다). */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b);
      b.in = (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), b);
      b.is = (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b);
      b.or = () => b;
      b.order = () => b;
      b.range = (from: number, to: number) => ((rows = rows.slice(from, to + 1)), b);
      b.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return b;
    },
  } as never;
}

describe("서버 조회(loadUnsentReasonCards) — 보이는 줄만 · 원스크린과 같은 반 보드 판정", () => {
  const T = "tn";
  const report = (over: Record<string, unknown>) => ({
    tenant_id: T,
    id: "r1",
    student_id: "s-jys",
    class_id: "c-bs1l",
    makeup: false,
    makeup_class_id: null,
    subject: "math",
    report_date: "2026-11-03",
    teacher_name: "남정화",
    notes: "오늘은 비례식을 끝까지 풀어냈습니다.",
    progress: "비례식",
    classnote_deadline_exempt_at: null,
    ment_source: "auto",
    classnote_status: null,
    source: "onescreen",
    ...over,
  });
  const tables = {
    lesson_reports: [
      report({}),
      report({ id: "r2", student_id: "s-ok" }),
      report({ id: "r3", student_id: "s-jj", class_id: "c-jj" }),
      report({ id: "sent", classnote_status: "success" }),
      report({ id: "r4", student_id: "s-ok", ment_source: null }),
      // 반 없는 보강 줄(운영 모양: class_id 없음 + 보강 반) · 합침 줄(운영 모양: makeup=true + 정규 반 · 보강 반 없음).
      report({ id: "r5", student_id: "s-ok", makeup: true, class_id: null, makeup_class_id: "c-bs1l" }),
      report({ id: "r6", student_id: "s-jys", makeup: true, class_id: "c-bs1l", makeup_class_id: null }),
      report({ id: "r7", student_id: "s-jys", makeup: true, class_id: null, makeup_class_id: "c-bs1l" }),
    ],
    classes: [
      { tenant_id: T, id: "c-bs1l", subject: "math", is_active: true, report_optout: false, closed_at: null },
      { tenant_id: T, id: "c-jj", subject: "math", is_active: true, report_optout: true, closed_at: null },
    ],
    classnote_class_boards: [{ tenant_id: T, class_id: "c-bs1l" }],
    classnote_class_board_members: [
      { tenant_id: T, class_id: "c-bs1l", student_id: "s-jys", status: "hold", reason: HOLD },
      { tenant_id: T, class_id: "c-bs1l", student_id: "s-ok", status: "ok", reason: null },
    ],
    students: ["s-jys", "s-ok", "s-jj"].map((id) => ({ tenant_id: T, id, status: "enrolled", is_test: false })),
    enrollments: ["s-jys", "s-ok"].map((sid) => ({ tenant_id: T, student_id: sid, class_id: "c-bs1l", start_date: "2026-09-01", end_date: null })),
    attendance_records: ["s-jys", "s-ok", "s-jj"].map((sid, i) => ({
      tenant_id: T,
      id: `a${i}`,
      student_id: sid,
      class_id: sid === "s-jj" ? "c-jj" : "c-bs1l",
      session_date: "2026-11-03",
      status: "present",
      recorded_at: "2026-11-03T08:00:00Z",
    })),
  };

  it("🔴 전유솔 = 배정 보류 카드 · 배정이 확인된 학생 = '아직 누르지 않았다' · 미발송 반 = 그 반 문장 · 이미 나간 건 = 카드 없음", async () => {
    const { loadUnsentReasonCards } = await import("./server/unsent-reasons");
    const cards = await loadUnsentReasonCards(T, ["r1", "r2", "r3", "sent"], fakeDb(tables));
    expect(Object.keys(cards).sort()).toEqual(["r1", "r2", "r3"]);
    expect(cards.r1!.rows).toContainEqual(["보류 사유", HOLD]);
    expect(cards.r2!.lines).toEqual([UNSENT_NOT_PRESSED]);
    expect(cards.r3!.lines).toContain(REPORT_OPTOUT_NOTICE);
    // 반 보드 기록의 다른 학생 줄은 카드에 실리지 않는다.
    expect(JSON.stringify(cards.r1)).not.toContain("s-ok");
  });

  it("🔴 저장된 작성 방식이 자동작성이 아니면 '자동작성' 안내 · 보강 확인 전이면 보강 확인 안내(서버 발송 겹과 같은 재료)", async () => {
    makeupPending.clear();
    makeupPending.add("r5");
    const { loadUnsentReasonCards } = await import("./server/unsent-reasons");
    const cards = await loadUnsentReasonCards(T, ["r4", "r5"], fakeDb(tables));
    expect(JSON.stringify(cards.r4)).toContain("'자동작성'으로 만든 글만 보낼 수 있습니다");
    expect(JSON.stringify(cards.r5)).toContain("보강 예약이 든 보고서입니다");
    expect(cards.r5!.lines).not.toContain(UNSENT_NOT_PRESSED);
  });

  // 리뷰 2026-11-04: 합침(정규+보강) 줄은 반이 있어 실제 발송이 정규 반 보드로 판정한다 — '보강 반을 바꿔야'가 아니다.
  it("🔴 합침 줄 = 정규 반 보드 문장 · 반 없는 보강 줄 = '보강 반을 바꿔야'", async () => {
    makeupPending.clear();
    const { loadUnsentReasonCards } = await import("./server/unsent-reasons");
    const cards = await loadUnsentReasonCards(T, ["r6", "r7"], fakeDb(tables));
    expect(cards.r6!.lines).not.toContain(UNSENT_MAKEUP_BOARD);
    expect(cards.r6!.lines?.some((l) => typeof l === "string" && l.includes("관리자 확인이 필요합니다"))).toBe(true);
    expect(cards.r7!.lines).toContain(UNSENT_MAKEUP_BOARD);
  });
});
