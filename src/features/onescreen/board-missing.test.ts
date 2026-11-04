// 정규 보고서가 "이 학생이 받을 반 보드가 없다"로 막혔을 때 — 까닭을 가려 말하고, 기다리면 풀리는 까닭이면 동기화를 요청한다(2026-10-03).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sheetTf } from "@/features/teacher-view/i18n";
import { isAutoSyncRequest } from "@/features/report-admin/server/classnote-sync-auto";
// 워커 .mjs — "기다리면 풀린다"의 근거(동기화 대상 기준)가 앱 판정과 같은 조건을 쓰는지 원문으로 고정한다.
import {
  BOARD_MISSING_ERROR,
  boardHoldReasonText,
  boardMissingNotice,
  boardMissingPreview,
  boardMissingWorthSync,
  classifyBoardMissing,
  isBoardBlockedStatus,
  isBoardMissingStatus,
  isBoardWaitStatus,
  type BoardMissingKind,
} from "./send-class";

const m = vi.hoisted(() => ({
  enrollments: [] as { start_date: string | null; end_date: string | null }[],
  members: [] as { status: string | null; reason: string | null }[],
  klass: null as Record<string, unknown> | null,
  student: null as Record<string, unknown> | null,
  linkCount: 1,
  classMemberCount: 5,
  failTable: null as string | null,
  filters: [] as { table: string; col: string; val: unknown }[],
  request: vi.fn(),
  loadRows: vi.fn(),
  /** 요청이 불린 순간 '서버가 대신 내는 요청' 문맥 안이었는가 — 감싸기를 걷으면 선생님의 요청이 거절된다. */
  requestedAsAuto: [] as boolean[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-10-03" }));
vi.mock("@/features/report-admin/server/classnote-sync-actions", () => ({ requestClassnoteBoardSync: m.request }));
vi.mock("@/features/report-admin/server/classnote-sync-core", () => ({ loadSyncRows: m.loadRows }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let head = false;
      const fail = () => (m.failTable === table ? { message: "boom" } : null);
      const q = {
        select(_cols: string, opts?: { head?: boolean }) {
          head = !!opts?.head;
          return q;
        },
        eq(col: string, val: unknown) {
          m.filters.push({ table, col, val });
          return q;
        },
        maybeSingle: () => Promise.resolve({ data: table === "classes" ? m.klass : m.student, error: fail() }),
        then(resolve: (v: unknown) => void) {
          if (table === "enrollments") return resolve({ data: m.enrollments, error: fail() });
          if (table === "classnote_class_boards") return resolve({ count: m.linkCount, error: fail() });
          // 반 보드 기록 — 이 학생의 행(data) 또는 반 전체 수(head count)
          return resolve(head ? { count: m.classMemberCount, error: fail() } : { data: m.members, error: fail() });
        },
      };
      return q;
    },
  }),
}));

const { explainBoardMissing } = await import("./server/send-class");

const LIVE_REQUEST = { status: "pending", scope: { full: false, classIds: ["c1"], studentIds: ["s1"] }, nextScope: null };

beforeEach(() => {
  m.enrollments = [{ start_date: "2026-09-01", end_date: null }];
  m.members = [];
  m.klass = { is_active: true, report_optout: false, subject: "math", closed_at: null };
  m.student = { status: "enrolled", is_test: false };
  m.linkCount = 1;
  m.classMemberCount = 5;
  m.failTable = null;
  m.filters = [];
  m.request.mockReset();
  m.requestedAsAuto.length = 0;
  m.request.mockImplementation(async () => {
    m.requestedAsAuto.push(isAutoSyncRequest());
    return { ok: true, message: "요청했습니다" };
  });
  m.loadRows.mockReset();
  m.loadRows.mockResolvedValue({ active: LIVE_REQUEST, latest: null });
});

const base = { liveNow: true, ended: false, syncTarget: true, classLinked: true, classMemberCount: 5, memberStatuses: [] as (string | null)[] };

describe("까닭 가리기(순수)", () => {
  it("지금 다니는데 이 학생만 기록이 없다 = 배정 중 · 반 연결이 아직 없다 = 새 반 · 수강이 끝났다 = 반을 떠남", () => {
    expect(classifyBoardMissing(base)).toBe("enrolling");
    expect(classifyBoardMissing({ ...base, classLinked: false, classMemberCount: 0 })).toBe("class_pending");
    expect(classifyBoardMissing({ ...base, liveNow: false, ended: true })).toBe("left");
    // 다시 들어온 학생(예전 수강이 끝난 기록 + 지금 다님)은 '반을 떠남'이 아니다
    expect(classifyBoardMissing({ ...base, ended: true })).toBe("enrolling");
  });
  it("보류는 사유로 가른다 — '다음 동기화 때 배정'은 배정 중 · 학부모 가입 대기 · 그 밖(사람 확인)", () => {
    const hold = (holdReason: string | null) => classifyBoardMissing({ ...base, memberStatuses: ["hold"], holdReason });
    expect(hold("반 보드 배정 전 — 다음 동기화 때 배정됩니다")).toBe("enrolling");
    // 가입 대기 = 지금 문장(2026-11-02~ 원아 연결까지 없음) + 옛 문장 둘(다시 쓰이기 전 기록) — 배포 순서와 무관하게 셋 다
    expect(hold("ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음")).toBe("hold_join");
    expect(hold("ClassNote 미가입·미배정(1인 보드 원아 0명)")).toBe("hold_join");
    expect(hold("1인 보드 없음")).toBe("hold_join");
    // 원아 연결은 있는데 가드에 걸림(형제 계정 등) · 기록된 원아를 사람이 뗌 = 관리자 확인
    expect(hold('원아 "박세인" 이름이 학생(박세하)과 다름 — 형제 계정일 수 있어 확인 필요')).toBe("hold_other");
    expect(hold("이 학생과 연결된 원아 3명 — 사람 확인 필요")).toBe("hold_other");
    expect(hold("반 보드에서 확인된 원아가 지금 그 반 보드에 없음 — 확인 필요")).toBe("hold_other");
    expect(hold("(수학)김민수 생년 불일치(2012년생, 기대 2013년생)")).toBe("hold_other");
    expect(hold("같은 원아(id 123)가 여러 학생에게 잡힘: 박세인, 박세하")).toBe("hold_other");
    expect(hold("1인 보드 2개(중복)")).toBe("hold_other"); // '1인 보드 없음'과 다르다
    expect(hold(null)).toBe("hold_other");
    expect(classifyBoardMissing({ ...base, memberStatuses: ["ok", "hold"], holdReason: "1인 보드 없음" })).toBe("hold_join"); // 보류가 하나라도 있으면 워커가 못 보낸다
    // 🔴 사유가 둘 이상 이어지면 가입만의 문제가 아니다 — 사람이 풀어야 한다
    expect(hold("1인 보드 없음 / 같은 반 동명이인(김민수) — 원장 확인 전 자동 배정 금지")).toBe("hold_other");
  });
  it("🔴 사유 문장은 워커 원문과 같아야 한다 — 워커가 문장·잇는 글자를 바꾸면 조용히 '관리자 확인'으로 떨어진다", () => {
    const plan = readFileSync(join(process.cwd(), "scripts/_classnote/class-board-plan.mjs"), "utf8");
    const dbw = readFileSync(join(process.cwd(), "scripts/_classnote/math-class-boards-db.mjs"), "utf8");
    // 가입 대기 문장(2026-11-02~) — 워커가 이 상수로 적는다. 'ClassNote 미가입'으로 시작해야 옛 앱도 가입 대기로 알아본다.
    expect(plan).toContain('export const JOIN_WAIT_REASON = "ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음";');
    expect(plan).toContain("reasons: [JOIN_WAIT_REASON]");
    expect(classifyBoardMissing({ ...base, memberStatuses: ["hold"], holdReason: "ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음" })).toBe("hold_join");
    expect(dbw).toContain('reason: "반 보드 배정 전 — 다음 동기화 때 배정됩니다"');
    expect(dbw).toContain('h.reasons.join(" / ")');
  });
  it("🔴 기다려서 풀리는 일이 아니면 까닭 모름(옛 안내) — 동기화 대상이 아닌 반·학생 · 연결은 있는데 반 전체 기록이 빔 · 전부 ok인데 막힘 · 다닌 적 없음", () => {
    expect(classifyBoardMissing({ ...base, syncTarget: false })).toBe("unknown"); // 휴원·테스트 학생, 미발송·비활성·종강 반
    expect(classifyBoardMissing({ ...base, syncTarget: false, memberStatuses: ["hold"], holdReason: "1인 보드 없음" })).toBe("unknown");
    expect(classifyBoardMissing({ ...base, classMemberCount: 0 })).toBe("unknown"); // ClassNote에서 보드가 지워졌거나 특정 불가
    expect(classifyBoardMissing({ ...base, memberStatuses: ["ok"] })).toBe("unknown");
    expect(classifyBoardMissing({ ...base, liveNow: false })).toBe("unknown");
    expect(classifyBoardMissing({ ...base, liveNow: false, memberStatuses: ["hold"] })).toBe("unknown");
    const worth: BoardMissingKind[] = ["enrolling", "class_pending", "hold_join"];
    for (const k of ["enrolling", "class_pending", "hold_join", "hold_other", "left", "unknown"] as BoardMissingKind[])
      expect(boardMissingWorthSync(k), k).toBe(worth.includes(k));
  });
  it("🔴 '동기화 대상' 기준은 워커와 같은 조건이다 — 워커 조각이 바뀌면 이 판정도 함께 봐야 한다", () => {
    const load = readFileSync(join(process.cwd(), "scripts/_classnote/math-class-boards-load.mjs"), "utf8");
    // 워커도 보고서 발송 반만 동기화한다(원장 2026-11-04 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"* — 11-03 'JJ 맞춤'을 되돌림).
    // 앱(isSendCandidateClass가 report_optout을 거른다)과 같은 넓이라 "기다리면 풀린다"는 안내가 거짓이 되지 않는다.
    expect(load).toContain("c.is_active and not c.report_optout and c.subject in ('math', 'subject_1') and (c.closed_at is null or c.closed_at >= ${today})");
    expect(load).toContain("(e.end_date is null or e.end_date >= ${today}) and (e.start_date is null or e.start_date <= ${today})");
    expect(load).toContain("s.status = 'enrolled' and not coalesce(s.is_test, false)");
    const server = readFileSync(join(process.cwd(), "src/features/onescreen/server/send-class.ts"), "utf8");
    expect(server).toContain("(!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date >= today)");
    expect(server).toContain('st.status === "enrolled" && !st.is_test');
    expect(server).toContain("isSendCandidateClass({ subject: c.subject, is_active: c.is_active, report_optout: c.report_optout, closed_at: c.closed_at }, today)");
  });
});

describe("안내 문장 — 사실만 약속한다", () => {
  it("🔴 요청이 실려 있지 않으면 '요청했습니다'라고 쓰지 않는다", () => {
    expect(boardMissingNotice("enrolling", true)).toMatchObject({ status: "board_enrolling" });
    expect(boardMissingNotice("enrolling", true).error).toContain("지금 배정을 요청했습니다");
    const auto = boardMissingNotice("enrolling", false);
    expect(auto.status).toBe("board_enrolling_auto");
    expect(auto.error).not.toContain("요청했습니다");
    expect(auto.error).toContain("늦어도 다음 날 새벽"); // 새벽 정기 동기화가 근거(낮의 자동 동기화가 꺼져 있어도 참)
    expect(boardMissingNotice("hold_join", true, "ClassNote 미가입").error).toContain("다시 확인을 요청했습니다");
    expect(boardMissingNotice("hold_join", false, "ClassNote 미가입").error).not.toContain("요청했습니다");
    // 새 반은 요청하지 못했으면 "자동으로"를 약속하지 않는다(같은 이름 보드 때문에 못 만드는 반일 수 있다) — 옛 안내
    expect(boardMissingNotice("class_pending", true)).toMatchObject({ status: "board_class_pending" });
    expect(boardMissingNotice("class_pending", false)).toEqual({ status: "board_missing", error: BOARD_MISSING_ERROR });
  });
  it("가입 대기 보류만 학부모 가입을 말한다 · 그 밖의 보류는 관리자 확인 · 사유의 내부 번호는 뺀다", () => {
    const join_ = boardMissingNotice("hold_join", false, "ClassNote 미가입·미배정(1인 보드 원아 0명)");
    expect(join_).toMatchObject({ status: "board_hold", holdReason: "ClassNote 미가입·미배정(1인 보드 원아 0명)" });
    expect(join_.error).toContain("학부모의 ClassNote 가입 여부");
    const other = boardMissingNotice("hold_other", true, "같은 원아(id 123)가 여러 학생에게 잡힘: 박세인, 박세하");
    expect(other.status).toBe("board_hold_admin");
    expect(other.error).toContain("(같은 원아가 여러 학생에게 잡힘: 박세인, 박세하)");
    expect(other.error).toContain("관리자 확인이 필요합니다");
    expect(other.error).not.toContain("가입");
    expect(other.error).not.toContain("요청했습니다"); // 사람이 풀어야 하는 보류는 요청하지 않는다
    expect(boardHoldReasonText("반 보드 특정 불가 — 같은 이름 보드(#1317083)에 이 반 학생이 아닌 원아 2명이 있습니다")).toBe(
      "반 보드 특정 불가 — 같은 이름 보드에 이 반 학생이 아닌 원아 2명이 있습니다",
    );
    expect(boardHoldReasonText("연결된 ClassNote 반(#42)이 삭제됐습니다")).toBe("연결된 ClassNote 반이 삭제됐습니다");
    expect(boardHoldReasonText(null)).toBe("학부모의 ClassNote 가입·원아 확인이 끝나지 않았습니다");
    expect(boardHoldReasonText("  ")).toBe("학부모의 ClassNote 가입·원아 확인이 끝나지 않았습니다");
    expect(boardHoldReasonText("가".repeat(200))).toBe(`${"가".repeat(80)}…`);
    expect(boardHoldReasonText("줄\n바꿈  사유")).toBe("줄 바꿈 사유");
    const left = boardMissingNotice("left", false);
    expect(left.status).toBe("board_left");
    expect(left.error).toContain("수강이 끝나");
    expect(left.error).toContain("다른 반으로 보내지 않습니다");
    expect(boardMissingNotice("unknown", true)).toEqual({ status: "board_missing", error: BOARD_MISSING_ERROR });
  });
  it("모든 문장은 '저장은 됐습니다'로 끝난다(발송만 막혔다) · 영문 코드·내부 번호가 없다 — 실제 워커 사유로", () => {
    const reasons = [
      "ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음",
      "ClassNote 미가입·미배정(1인 보드 원아 0명)",
      "같은 원아(id 123)가 여러 학생에게 잡힘: 가, 나",
      "반 보드 특정 불가 — 같은 이름 보드(#1317083) 원아 조회 실패 — 채택 보류",
    ];
    const all = [
      boardMissingNotice("enrolling", true),
      boardMissingNotice("enrolling", false),
      boardMissingNotice("class_pending", true),
      ...reasons.flatMap((r) => [boardMissingNotice("hold_join", true, r), boardMissingNotice("hold_join", false, r), boardMissingNotice("hold_other", false, r)]),
      boardMissingNotice("left", false),
      boardMissingNotice("unknown", false),
    ];
    for (const n of all) {
      expect(n.error.endsWith("저장은 됐습니다")).toBe(true);
      expect(n.error).not.toMatch(/board_|enrolling|hold|member|sync|\bid\b|#\d/i);
      expect(isBoardMissingStatus(n.status)).toBe(true);
    }
    expect(isBoardMissingStatus("no_class")).toBe(false);
    // 일괄 발송 집계 — 배정되면 다시 보낼 수 있는 것 / 사람이 풀어야 하는 것 / 옛 '실패'
    expect(["board_enrolling", "board_enrolling_auto", "board_class_pending", "board_hold_recheck"].every(isBoardWaitStatus)).toBe(true);
    expect(["board_hold", "board_hold_admin", "board_left"].every(isBoardBlockedStatus)).toBe(true);
    expect(["board_hold", "board_hold_admin", "board_left", "board_missing", "no_class", null].some(isBoardWaitStatus)).toBe(false);
    expect(["board_enrolling", "board_missing", "no_class", null].some(isBoardBlockedStatus)).toBe(false);
  });
  it("미리 보기 문장 — 요청할 수 있는 까닭은 '발송을 누르면 요청한다'고 알린다 · 아니면 발송 때와 같은 문장", () => {
    expect(boardMissingPreview("enrolling")).toContain("발송을 누르면 지금 배정을 요청합니다");
    expect(boardMissingPreview("class_pending")).toContain("발송을 누르면 지금 만들기를 요청합니다");
    expect(boardMissingPreview("hold_join", "1인 보드 없음")).toContain("(1인 보드 없음) — 발송을 누르면 다시 확인을 요청합니다");
    for (const k of ["enrolling", "class_pending", "hold_join"] as BoardMissingKind[]) expect(boardMissingPreview(k, "사유")).not.toContain("요청했습니다");
    expect(boardMissingPreview("hold_other", "생년 불일치")).toBe(boardMissingNotice("hold_other", false, "생년 불일치").error);
    expect(boardMissingPreview("left")).toBe(boardMissingNotice("left", false).error);
    expect(boardMissingPreview("unknown")).toBe(BOARD_MISSING_ERROR);
  });
  it("🔴 강사뷰 사전의 한국어 문장은 서버 문장과 한 벌이다(화면은 결과 코드로 사전을 탄다)", () => {
    const ko = (key: string, reason = "") => sheetTf("ko", key as never, { reason });
    expect(ko("os.c.boardEnrolling")).toBe(boardMissingNotice("enrolling", true).error);
    expect(ko("os.c.boardEnrollingAuto")).toBe(boardMissingNotice("enrolling", false).error);
    expect(ko("os.c.boardClassPending")).toBe(boardMissingNotice("class_pending", true).error);
    expect(ko("os.c.boardHoldRecheck", "ClassNote 미가입")).toBe(boardMissingNotice("hold_join", true, "ClassNote 미가입").error);
    expect(ko("os.c.boardHold", "ClassNote 미가입")).toBe(boardMissingNotice("hold_join", false, "ClassNote 미가입").error);
    expect(ko("os.c.boardHoldAdmin", "생년 불일치")).toBe(boardMissingNotice("hold_other", false, "생년 불일치").error);
    expect(ko("os.c.boardLeft")).toBe(boardMissingNotice("left", false).error);
    expect(ko("os.c.boardMissing")).toBe(BOARD_MISSING_ERROR);
    // 영어 문장도 사유 자리를 채운다
    expect(sheetTf("en", "os.c.boardHold" as never, { reason: "X" })).toContain("(X)");
    expect(sheetTf("en", "os.c.boardHoldAdmin" as never, { reason: "X" })).toContain("(X)");
  });
});

describe("서버 — 까닭을 읽고, 풀릴 수 있으면 그 반·학생의 동기화를 요청한다", () => {
  const explain = (request = true) => explainBoardMissing("t1", "c1", "s1", { request });
  it("방금 배정된 신입(오늘 시작 · 이 학생만 기록 없음) = 배정 요청 + '요청했습니다' — 그 반·그 학생만, 버튼과 같은 함수로", async () => {
    m.enrollments = [{ start_date: "2026-10-03", end_date: null }];
    expect(await explain()).toMatchObject({ status: "board_enrolling", requestable: true });
    expect(m.request).toHaveBeenCalledTimes(1);
    expect(m.request).toHaveBeenCalledWith({ classIds: ["c1"], studentIds: ["s1"], source: "send_blocked" });
    // 🔴 이 요청은 '서버가 대신 내는 요청' 문맥 안에서 나간다 — 선생님은 그 문맥 밖에서는 요청할 수 없다(2026-10-06).
    expect(m.requestedAsAuto).toEqual([true]);
    expect(isAutoSyncRequest()).toBe(false);
    // 🔴 admin 조회는 전부 지점으로 좁힌다(RLS 우회) — 반·학생으로도
    for (const table of ["enrollments", "classnote_class_board_members", "classes", "students", "classnote_class_boards"])
      expect(m.filters.some((f) => f.table === table && f.col === "tenant_id" && f.val === "t1"), table).toBe(true);
    for (const [table, col, val] of [["enrollments", "student_id", "s1"], ["enrollments", "class_id", "c1"], ["classes", "id", "c1"], ["students", "id", "s1"], ["classnote_class_boards", "class_id", "c1"]])
      expect(m.filters.some((f) => f.table === table && f.col === col && f.val === val), `${table}.${col}`).toBe(true);
  });
  it("🔴 '요청했다'는 되읽은 요청 표로 판정한다 — 대답이 성공이어도 살아 있는 요청에 이 반이 없으면 말하지 않는다", async () => {
    m.loadRows.mockResolvedValue({ active: null, latest: null }); // 그 사이 끝났다
    expect(await explain()).toMatchObject({ status: "board_enrolling_auto" });
    m.loadRows.mockResolvedValue({ active: { ...LIVE_REQUEST, scope: { full: false, classIds: ["다른 반"], studentIds: [] } }, latest: null }); // 합류가 범위를 못 실었다
    expect(await explain()).toMatchObject({ status: "board_enrolling_auto" });
    m.loadRows.mockResolvedValue({ active: { ...LIVE_REQUEST, scope: { full: true, classIds: [], studentIds: [] } }, latest: null }); // 전체 대조 요청
    expect(await explain()).toMatchObject({ status: "board_enrolling" });
    // 실행 중 요청 — 다음 범위(끝난 뒤 이어서 돈다)에 실려 있어도 요청된 것이다
    m.loadRows.mockResolvedValue({ active: { status: "running", scope: { full: false, classIds: ["x"], studentIds: [] }, nextScope: { full: false, classIds: ["c1"], studentIds: ["s1"] } }, latest: null });
    expect(await explain()).toMatchObject({ status: "board_enrolling" });
    m.loadRows.mockRejectedValue(new Error("boom"));
    expect(await explain()).toMatchObject({ status: "board_enrolling_auto" });
  });
  it("🔴 요청이 거절되면(쿨다운·연동 PC 꺼짐) '요청했습니다'라고 하지 않는다 · 요청이 던져도 안내는 나간다", async () => {
    m.request.mockResolvedValue({ ok: false, error: "조금 전에 동기화했습니다 — 3분 뒤 다시 누를 수 있습니다" });
    expect(await explain()).toMatchObject({ status: "board_enrolling_auto" });
    expect(m.loadRows).not.toHaveBeenCalled();
    m.request.mockRejectedValue(new Error("boom"));
    expect(await explain()).toMatchObject({ status: "board_enrolling_auto" });
  });
  it("새 반(연결 없음) = 만들기 요청 · 요청 못 했으면 옛 안내", async () => {
    m.linkCount = 0;
    m.classMemberCount = 0;
    expect(await explain()).toMatchObject({ status: "board_class_pending", requestable: true });
    m.request.mockResolvedValue({ ok: false, error: "연동 PC가 꺼져 있습니다" });
    expect(await explain()).toMatchObject({ status: "board_missing", requestable: true });
  });
  it("배정 보류 — 가입 대기는 사유와 함께 다시 확인을 요청한다 · 그 밖의 보류는 요청하지 않고 관리자 확인", async () => {
    m.members = [{ status: "hold", reason: "ClassNote 미가입·미배정(1인 보드 원아 0명)" }];
    expect(await explain()).toMatchObject({ status: "board_hold_recheck", holdReason: "ClassNote 미가입·미배정(1인 보드 원아 0명)", requestable: true });
    expect(m.request).toHaveBeenCalledTimes(1);
    m.request.mockClear();
    m.members = [{ status: "hold", reason: "(수학)김민수 보호자 전화 불일치" }];
    expect(await explain()).toMatchObject({ status: "board_hold_admin", requestable: false });
    expect(m.request).not.toHaveBeenCalled();
    m.members = [{ status: "hold", reason: "반 보드 배정 전 — 다음 동기화 때 배정됩니다" }];
    expect(await explain()).toMatchObject({ status: "board_enrolling" });
  });
  it("🔴 동기화가 넣지 않는 반·학생은 요청하지 않고 옛 안내 — 휴원·테스트 학생 · 미발송·비활성·종강·비수학 반 · 보드가 지워진 반", async () => {
    const cases: Array<() => void> = [
      () => (m.student = { status: "on_hold", is_test: false }),
      () => (m.student = { status: "enrolled", is_test: true }),
      () => (m.student = null),
      () => (m.klass = { is_active: true, report_optout: true, subject: "math", closed_at: null }),
      () => (m.klass = { is_active: false, report_optout: false, subject: "math", closed_at: null }),
      () => (m.klass = { is_active: true, report_optout: false, subject: "english", closed_at: null }),
      () => (m.klass = { is_active: true, report_optout: false, subject: "math", closed_at: "2026-10-02" }),
      () => (m.klass = null),
      () => (m.classMemberCount = 0), // 연결은 있는데 반 전체 기록이 비었다
    ];
    for (const [i, set] of cases.entries()) {
      m.student = { status: "enrolled", is_test: false };
      m.klass = { is_active: true, report_optout: false, subject: "math", closed_at: null };
      m.classMemberCount = 5;
      set();
      expect(await explain(), `경우 ${i}`).toEqual({ status: "board_missing", error: BOARD_MISSING_ERROR, requestable: false });
    }
    expect(m.request).not.toHaveBeenCalled();
    // 종강일 당일까지는 대상이다(워커 `closed_at >= today`)
    m.klass = { is_active: true, report_optout: false, subject: "subject_1", closed_at: "2026-10-03" };
    m.classMemberCount = 5;
    expect(await explain()).toMatchObject({ status: "board_enrolling" });
  });
  it("🔴 반을 떠난 학생 = 요청하지 않는다(다시 생기지 않는다) · 종료일 당일까지는 '지금 다님' · 아직 시작 전이면 옛 안내", async () => {
    m.enrollments = [{ start_date: "2026-08-01", end_date: "2026-10-02" }];
    expect(await explain()).toMatchObject({ status: "board_left", requestable: false });
    expect(m.request).not.toHaveBeenCalled();
    m.enrollments = [{ start_date: "2026-08-01", end_date: "2026-10-03" }];
    expect(await explain()).toMatchObject({ status: "board_enrolling" });
    m.request.mockClear();
    m.enrollments = [{ start_date: "2026-10-06", end_date: null }];
    expect(await explain()).toMatchObject({ status: "board_missing" });
    expect(m.request).not.toHaveBeenCalled();
  });
  it("🔴 미리 보기(request=false)는 까닭만 가리고 요청하지 않는다(문장도 미리 보기용) · 조회 실패는 옛 안내(던지지 않는다)", async () => {
    const preview = await explain(false);
    expect(preview).toMatchObject({ status: "board_enrolling_auto", requestable: true });
    expect(preview.error).toContain("발송을 누르면 지금 배정을 요청합니다");
    expect(m.request).not.toHaveBeenCalled();
    for (const table of ["enrollments", "classnote_class_board_members", "classes", "students", "classnote_class_boards"]) {
      m.failTable = table;
      expect(await explain(), table).toEqual({ status: "board_missing", error: BOARD_MISSING_ERROR, requestable: false });
    }
    expect(m.request).not.toHaveBeenCalled();
  });
});

describe("배선 — 두 발송 경로와 화면", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const ONESCREEN = read("src/features/onescreen/server/actions.ts");
  const COMPOSE = read("src/features/report-admin/server/compose-actions.ts");
  const CLIENT = read("src/features/onescreen/components/onescreen-client.tsx");
  const FACE = read("src/app/(shell)/lesson-reports/_components/compose-face.tsx");
  it("원스크린·관리자 직접 작성의 발송은 까닭을 가리고 요청한다 · 관리자 미리 보기는 요청하지 않는다", () => {
    expect(ONESCREEN).toContain("explainBoardMissing(user.tenantId, input.classId, input.studentId, { request: true })");
    expect(COMPOSE).toContain("explainBoardMissing(user.tenantId, classId, input.studentId, { request: true })");
    expect(COMPOSE).toContain("explainBoardMissing(user.tenantId, classId, args.studentId, { request: false })");
    expect(COMPOSE.match(/request: true/g)).toHaveLength(1);
    // 🔴 발송을 대기에 올리지 않은 뒤에 부른다(막힌 채로 큐에 남지 않게)
    expect(ONESCREEN).toMatch(/if \(!classLive\) \{\s*await unqueue\(\);[\s\S]{0,260}explainBoardMissing\(/);
    expect(COMPOSE).toMatch(/if \(!classLive\) \{\s*await unqueue\(\);[\s\S]{0,260}explainBoardMissing\(/);
  });
  it("🔴 관리자 직접 작성 — 요청할 수 있는 까닭이면 발송 버튼을 잠그지 않는다(눌러야 서버가 막으면서 요청한다)", () => {
    expect(COMPOSE).toContain("blockedReason: why.error, requestable: why.requestable, reportClassName");
    expect(FACE).toContain("requestable: !!res.requestable,");
    expect(FACE).toContain("sendOpt.needed && !sendOpt.requestable && (!sendOpt.candidates.length || !sendClassId)");
  });
  it("화면은 결과 코드로 사전을 타고 · 일괄 발송은 '배정 대기'를 실패로 세지 않는다", () => {
    for (const [status, key] of [
      ["board_enrolling", "os.c.boardEnrolling"],
      ["board_enrolling_auto", "os.c.boardEnrollingAuto"],
      ["board_class_pending", "os.c.boardClassPending"],
      ["board_hold_recheck", "os.c.boardHoldRecheck"],
      ["board_hold", "os.c.boardHold"],
      ["board_hold_admin", "os.c.boardHoldAdmin"],
      ["board_left", "os.c.boardLeft"],
    ])
      expect(CLIENT).toMatch(new RegExp(`res\\.status === "${status}"\\s*\\? "${key.replace(/\./g, "\\.")}"`));
    expect(CLIENT).toContain("if (isBoardWaitStatus(res.status)) boardWait++;");
    expect(CLIENT).toContain('else if (res.status === "no_class" || isBoardBlockedStatus(res.status)) noClass++;');
    expect(CLIENT).toContain('tf("os.c.bulkBoardWait", { n: boardWait })');
  });
});
