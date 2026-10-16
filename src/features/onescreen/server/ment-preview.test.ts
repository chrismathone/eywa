import { beforeEach, describe, expect, it, vi } from "vitest";

// AI 멘트 탭 미리보기 = 운영 자동작성과 같은 재료·조립·모델(원장 2026-10-16 후속). DB는 표마다 행을 돌려주는 가짜 —
// 🔴 거르는 칸이 행에 없으면 그 행을 떨어뜨린다(지점 필터를 빼면 테스트가 깨지게).
const m = vi.hoisted(() => ({ generate: vi.fn(), settings: vi.fn(), history: vi.fn(), style: vi.fn(), receipt: vi.fn(), tpl: vi.fn(), special: vi.fn() }));
vi.mock("@/lib/ai/generate", () => ({ generateJSON: m.generate }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("./score-history", () => ({ fetchScoreHistory: m.history, fetchSpecialClassIds: m.special }));
vi.mock("./ment-style-db", () => ({ loadTeacherMentStyle: m.style }));
vi.mock("./prompt-loader", () => ({ loadActivePrompt: m.tpl }));
vi.mock("@/features/video-homework/server/receipt-comment", () => ({ getVideoReceiptComment: m.receipt }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("../ment-style-prompt", () => ({ mentStyleDirective: () => "@@말투@@", mentStyleToneDirective: () => "@@어조@@" }));
import { runMentPreview } from "./ment-preview";

type Row = Record<string, unknown>;
const T = "tenant";
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      const lts: [string, string][] = [];
      let desc: string | null = null;
      const rows = () => {
        const out = (tables[table] ?? []).filter(
          (r) => eqs.every(([k, v]) => k in r && r[k] === v) && lts.every(([k, v]) => k in r && String(r[k]) < v),
        );
        return desc ? [...out].sort((a, b) => String(b[desc!]).localeCompare(String(a[desc!]))) : out;
      };
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => (eqs.push([k, v]), b),
        lt: (k: string, v: string) => (lts.push([k, v]), b),
        order: (k: string) => ((desc = k), b),
        limit: () => b,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
      };
      return b;
    },
  } as never;
}

const DATE = "2026-10-15";
const report = (o: Row = {}) => ({
  tenant_id: T, id: "r1", student_id: "s1", class_id: "c1aaaaaa-0000-4000-8000-000000000001", subject: "math", makeup: false, created_by: "t1", report_date: DATE,
  exam_info: "일일 4/5", progress: "수학 일차방정식의 활용", daily_test: "5문제 중 4개 맞음", check_test: "", attitude: "매우 좋음", homework_score: "100%",
  textbook: "", homework_today: "12-20p", video_homework: null, video_homework_due: null, ...o,
});
const C1 = "c1aaaaaa-0000-4000-8000-000000000001";
const session = (student: string, teacher: string, sp: Row) => ({ tenant_id: T, student_id: student, session_date: DATE, updated_by: teacher, class_id: C1, special_note: null, subject_progress: sp });
const people = { students: [{ tenant_id: T, id: "s1", name: "학원이" }], users: [{ tenant_id: T, id: "t1", name: "이수진", report_notice_mode: null }, { tenant_id: T, id: "t2", name: "박선생", report_notice_mode: null }] };

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ operations: { subjects: [{ key: "math", label: "수학", color: "blue" }] }, report: { noticeMode: "A" } });
  m.history.mockResolvedValue([]);
  m.style.mockResolvedValue({});
  m.receipt.mockResolvedValue(null);
  m.tpl.mockResolvedValue(null);
  m.special.mockResolvedValue([]);
  m.generate.mockResolvedValue({ data: { comment: "생성 멘트" }, model: "claude-haiku-5-5" });
});
const promptOf = () => m.generate.mock.calls[0]![0].prompt as string;

describe("runMentPreview", () => {
  it("보고서 작성자의 특이사항·수업 성격·말투로, 운영과 같은 모델(fast)·상한으로 쓴다", async () => {
    const db = fakeDb({
      ...people,
      lesson_reports: [report()],
      // 같은 날 같은 반 칸이 두 선생님 몫으로 — 작성자(t1) 것을 쓴다
      onescreen_daily_sessions: [session("s1", "t2", { [C1]: { note: "다른 선생님 메모" } }), session("s1", "t1", { [C1]: { note: "풀이 과정을 끝까지 적음", mode: "복습" } })],
    });
    const r = await runMentPreview(db, T, "comment", "고친 멘트 {{facts}}", "r1");
    expect(r.ok).toBe(true);
    expect(m.generate.mock.calls[0]![0]).toMatchObject({ tier: "fast", maxTokens: 1800, meta: { feature: "ment_prompt_preview", tenantId: T } });
    const p = promptOf();
    expect(p).toContain("고친 멘트");
    expect(p).toContain("풀이 과정을 끝까지 적음");
    expect(p).not.toContain("다른 선생님 메모");
    expect(p).toContain("오늘 복습:");
    expect(p).toContain("@@말투@@");
    expect(p).not.toContain("수학 일차방정식"); // 진도에서 과목 라벨을 뗀다
    expect(m.style).toHaveBeenCalledWith(expect.anything(), T, "t1");
    expect(r.output).toContain("[학부모 멘트]\n생성 멘트");
    expect(r.output).toContain("Claude Haiku · 단일 멘트(A) · 특이사항 있음 · 이수진 선생님 말투");
  });

  it("직전 회차 = 같은 과목의 가장 최근 회차(반은 안 본다 · 화면과 같다) · 문항 수가 다르면 · 특강 행이 있으면 증감 없음", async () => {
    const prior = (o: Row) => ({ tenant_id: T, student_id: "s1", class_id: C1, subject: "math", ...o });
    const reports = [report(), prior({ id: "p1", report_date: "2026-10-10", exam_info: "일일 1/5" }), prior({ id: "p2", report_date: "2026-10-13", class_id: null, exam_info: "일일 3/5" })];
    await runMentPreview(fakeDb({ ...people, lesson_reports: reports, onescreen_daily_sessions: [] }), T, "comment", "{{facts}}", "r1");
    expect(promptOf()).toContain("(지난 회차 대비 ▲1)");
    m.generate.mockClear();
    const scale = [report(), prior({ id: "p1", report_date: "2026-10-13", exam_info: "일일 2/20" })];
    await runMentPreview(fakeDb({ ...people, lesson_reports: scale, onescreen_daily_sessions: [] }), T, "comment", "{{facts}}", "r1");
    expect(promptOf()).not.toContain("지난 회차");
    m.generate.mockClear();
    m.special.mockResolvedValue(["sp000000-0000-4000-8000-000000000009"]);
    const withSpecial = [session("s1", "t1", { [C1]: { note: "" }, "sp000000-0000-4000-8000-000000000009": {} })];
    await runMentPreview(fakeDb({ ...people, lesson_reports: reports, onescreen_daily_sessions: withSpecial }), T, "comment", "{{facts}}", "r1");
    expect(promptOf()).not.toContain("지난 회차");
  });

  it("보강만 있는 행은 `makeup::과목` 칸의 메모를 쓴다(반 칸·옛 과목 칸으로 새지 않게)", async () => {
    const db = fakeDb({
      ...people,
      lesson_reports: [report({ class_id: null, makeup: true })],
      onescreen_daily_sessions: [session("s1", "t1", { "makeup::math": { note: "보강 칸 메모" }, math: { note: "옛 과목 칸 메모" } })],
    });
    await runMentPreview(db, T, "comment", "{{facts}}", "r1");
    expect(promptOf()).toContain("보강 칸 메모");
    expect(promptOf()).not.toContain("옛 과목 칸 메모");
  });

  it("그 선생님 명단에서 셋 이상이 같은 글이면 반 전체 안내로 준다(화면과 같은 판정)", async () => {
    const note = "내일 특강은 1시입니다.";
    const db = fakeDb({
      ...people,
      lesson_reports: [report()],
      onescreen_daily_sessions: ["s1", "s2", "s3"].map((s) => session(s, "t1", { [C1]: { note } })),
    });
    const r = await runMentPreview(db, T, "comment", "{{facts}}", "r1");
    expect(promptOf()).toContain("반 전체 안내");
    expect(r.output).toContain("특이사항 없음 · 반 전체 안내 있음");
  });

  it("다른 지점의 보고서는 찾지 못한다", async () => {
    const db = fakeDb({ ...people, lesson_reports: [report({ tenant_id: "other" })], onescreen_daily_sessions: [] });
    expect(await runMentPreview(db, T, "comment", "{{facts}}", "r1")).toEqual({ ok: false, error: "보고서를 찾을 수 없습니다" });
  });

  it("AI를 부르지 않고 막는 경우 — 쓸 추세가 없는 추세 프롬프트 · 고친 문단의 입력이 없음 · 영어 보고서", async () => {
    const base = { ...people, onescreen_daily_sessions: [] };
    expect((await runMentPreview(fakeDb({ ...base, lesson_reports: [report()] }), T, "trend", "{{historySummary}}", "r1")).error).toContain("추세 표본이 부족합니다");
    expect((await runMentPreview(fakeDb({ ...base, lesson_reports: [report({ attitude: "" })] }), T, "comment_p2", "{{p2facts}}", "r1")).error).toContain("고친 문단의 입력이 없습니다");
    expect((await runMentPreview(fakeDb({ ...base, lesson_reports: [report({ subject: "english" })] }), T, "comment", "{{facts}}", "r1")).error).toContain("영어 보고서");
    expect(m.generate).not.toHaveBeenCalled();
  });
});
