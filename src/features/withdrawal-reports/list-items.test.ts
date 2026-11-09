import { describe, expect, it } from "vitest";
import type { ArchiveRow } from "./archive-model";
import type { ReportListRow, StaffOption } from "./model";
import {
  buildListItems,
  filterListItems,
  listHref,
  listWindow,
  parseListFilters,
  reportProgress,
  teacherOptions,
  type ListItem,
  type ReportFlow,
  type ReportProgress,
} from "./list-items";

const staff: StaffOption[] = [
  { id: "t1", name: "이성우", role: "teacher", subjects: ["math"] },
  { id: "m1", name: "관리자", role: "admin", subjects: ["math"] },
];
/** 형제 조회가 성공했을 때의 묶음 상태(목록에 보이는 보고서 그대로) — 빠뜨리면 '조회 실패'로 읽힌다(리뷰 r2 (a) · 2단계 '확인 못 함'). */
const seen = (reports: readonly ReportListRow[]) => {
  const out = new Map<string, { id: string; status: ReportListRow["status"] }[]>();
  for (const r of reports) if (r.group_id) out.set(r.group_id, [...(out.get(r.group_id) ?? []), { id: r.id, status: r.status }]);
  return out;
};
const report = (over: Partial<ReportListRow> = {}): ReportListRow => ({
  id: "r1", tenant_id: "x", student_id: "s1", requested_by: "m1", teacher_id: "t1", manager_id: "m1", director_id: null,
  manager_ids: ["m1"], director_ids: [], manager_decisions: {}, director_decisions: {},
  exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-10-10", request_note: "",
  snapshot: { name: "김학생", school: "대구일중", grade: "중2", enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] },
  status: "manager_pending", revision: 1, manager_approved_at: null, director_approved_at: null, applied_at: null,
  last_comment: null, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
  ...over,
});
const archive = (over: Partial<ArchiveRow> = {}): ArchiveRow => ({
  id: "a1", spreadsheet_id: "sheet", sheet_id: 1, sheet_title: "9월 퇴원", source_range: "A1:H40",
  student_name: "박원생", school_grade: "경명여중1", class_name: "중1\n심화반", subject: "math", exit_date: "2026-09-20",
  raw_exit_date: "9/20", teacher_name: "Jane", mapped_student_id: null, mapping_kind: "unmapped", revision: 1,
  ...over,
});
const labelOf = (k: string) => ({ math: "수학", english: "영어" })[k] ?? k;
const build = (reports: ReportListRow[], archives: ArchiveRow[]) =>
  buildListItems({ reports, archives, staff, labelOf, userId: "t1" });
const all = parseListFilters({}, true);
const keys = (items: ListItem[]) => items.map((i) => i.key);

describe("퇴원보고서 목록 한 벌 — 웹 보고서 + 기존 스프레드시트 기록(원장 2026-10-14)", () => {
  it("두 출처를 한 줄 모양으로 — 기존 기록은 원문 이름·반(줄바꿈 접음)·과목 라벨, 학생 연결 상태", () => {
    const [web, old] = build([report()], [archive()]);
    expect(web).toMatchObject({ href: "/withdrawal-reports/r1", name: "김학생", detail: "퇴원 · 수학", subjectText: "수학", kindText: "퇴원", classText: "", teacher: "이성우", status: "pending", link: null, mine: "none" });
    expect(old).toMatchObject({
      href: "/withdrawal-reports/archive/a1", name: "박원생", schoolGrade: "경명여중1", requestedText: "—", detail: "중1 심화반 · 수학", subjectText: "수학", kindText: "—", classText: "중1 심화반", teacher: "Jane",
      status: "archive", statusLabel: "스프레드시트 기록", link: "unmapped", dateText: "2026-09-20",
    });
    expect(build([], [archive({ mapped_student_id: "s9", mapping_kind: "manual" })])[0]!.link).toBe("manual");
  });

  it("사유 칸 — 웹 보고서는 고른 사유, 기존 기록은 원문 글을 우리 사유로(없으면 기타 + 원문) · 사유로도 찾는다", () => {
    const [web, old, odd] = build(
      [report({ body_reason: "career", body_detail: "예체능으로 진로를 정함" })],
      [archive({ reason_raw: "학업의욕상실", detail_raw: "" }), archive({ id: "a2", exit_date: "2026-09-01", reason_raw: "학습태도 불량 / 금전적인 문제(집안사정)" })],
    );
    expect(web!.reason).toEqual({ text: "진로·진학", note: null });
    expect(old!.reason).toEqual({ text: "학생 상태 · 학습 의욕 저하", note: null });
    expect(odd!.reason).toEqual({ text: "기타", note: "학습태도 불량 / 금전적인 문제(집안사정)" });
    const found = filterListItems([web!, old!, odd!], { ...all, q: "학습 의욕" }, listWindow(all, "2026-10-16"));
    expect(keys(found)).toEqual(["a:a1"]);
  });

  it("사유 아래 설명 줄로도 찾는다 — 매핑 설명('힘듦') · 기타의 설명", () => {
    const [web, old] = build(
      [report({ body_reason: "other", body_detail: "집안 사정으로 쉬기로" })],
      [archive({ reason_raw: "수업진행이 빡세서", detail_raw: "" })],
    );
    expect(old!.reason).toEqual({ text: "수업·강사", note: "힘듦" });
    expect(keys(filterListItems([web!, old!], { ...all, q: "힘듦" }, listWindow(all, "2026-10-16")))).toEqual(["a:a1"]);
    expect(keys(filterListItems([web!, old!], { ...all, q: "집안 사정" }, listWindow(all, "2026-10-16")))).toEqual([web!.key]);
  });

  it("마지막 수업일 늦은 순, 날짜를 못 읽은 원문은 맨 뒤(원문 표기 그대로 보인다)", () => {
    const items = build([report({ id: "r2", effective_date: "2026-10-01" })], [archive(), archive({ id: "a2", exit_date: null, raw_exit_date: "9월 말" })]);
    expect(keys(items)).toEqual(["r:r2", "a:a1", "a:a2"]);
    expect(items[2]!.dateText).toBe("9월 말");
  });

  it("진행 중(처리할 일)은 날짜가 지나도 맨 위 — 기본 보기 '전체'에서 기존 기록 사이로 묻히지 않는다", () => {
    const items = build(
      [report({ id: "old-open", effective_date: "2026-08-01" }), report({ id: "done", status: "completed", effective_date: "2026-10-12" })],
      [archive()],
    );
    expect(keys(items)).toEqual(["r:old-open", "r:done", "a:a1"]);
  });

  it("상태 — 진행 중·완료·취소·스프레드시트 기록이 서로 안 섞인다", () => {
    const items = build([report(), report({ id: "r2", status: "completed" }), report({ id: "r3", status: "canceled" })], [archive()]);
    const by = (status: string) => keys(filterListItems(items, parseListFilters({ status }, true), listWindow(all, "2026-10-14")));
    expect(by("pending")).toEqual(["r:r1"]);
    expect(by("completed")).toEqual(["r:r2"]);
    expect(by("canceled")).toEqual(["r:r3"]);
    expect(by("archive")).toEqual(["a:a1"]);
  });

  it("요청 취소는 기본으로 숨긴다 — 끄면 보이고 · 상태를 '요청 취소'로 고르면 그대로 보인다(원장 2026-11-02)", () => {
    const items = build([report(), report({ id: "r3", status: "canceled" })], [archive()]);
    const shown = (sp: Record<string, string>) => {
      const f = parseListFilters(sp, true);
      return keys(filterListItems(items, f, listWindow(f, "2026-10-14"))).sort();
    };
    expect(parseListFilters({}, true).hideCanceled).toBe(true);
    expect(shown({})).toEqual(["a:a1", "r:r1"]);
    expect(shown({ canceled: "show" })).toEqual(["a:a1", "r:r1", "r:r3"]);
    expect(shown({ status: "canceled" })).toEqual(["r:r3"]);
  });

  it("미연결 필터는 없앴다 — 옛 주소가 남아 있어도 전부 보인다", () => {
    const items = build([report()], [archive(), archive({ id: "a2", mapped_student_id: "s2", mapping_kind: "auto" })]);
    const f = parseListFilters({ link: "unmapped" }, true);
    expect(filterListItems(items, f, listWindow(f, "2026-10-14"))).toHaveLength(3);
  });

  it("기존 기록을 못 보는 사람은 주소에 값이 남아 있어도 스프레드시트 기록 필터가 없다", () => {
    expect(parseListFilters({ status: "archive" }, false)).toMatchObject({ status: "all" });
  });

  it("기간 — 퇴원관리와 같은 창 계산 · 이번 달은 말일까지(처리 예약 포함) · 날짜 모르는 원문은 기간을 고르면 빠진다", () => {
    const items = build([report({ id: "future", effective_date: "2026-10-25" })], [archive(), archive({ id: "a2", exit_date: null })]);
    const pick = (sp: Record<string, string>) => {
      const f = parseListFilters(sp, true);
      return keys(filterListItems(items, f, listWindow(f, "2026-10-14")));
    };
    expect(pick({ range: "month" })).toEqual(["r:future"]);
    expect(pick({ range: "30d" })).toEqual(["a:a1"]);
    expect(pick({ range: "custom", from: "2026-09-01", to: "2026-09-30" })).toEqual(["a:a1"]);
    expect(pick({})).toEqual(["r:future", "a:a1", "a:a2"]);
  });

  it("과목·작성 강사·검색", () => {
    const items = build([report()], [archive({ subject: "english", teacher_name: "Jane" })]);
    const pick = (sp: Record<string, string>) => {
      const f = parseListFilters(sp, true);
      return keys(filterListItems(items, f, listWindow(f, "2026-10-14")));
    };
    expect(pick({ subject: "english" })).toEqual(["a:a1"]);
    expect(pick({ teacher: "이성우" })).toEqual(["r:r1"]);
    expect(pick({ q: "경명" })).toEqual(["a:a1"]);
    expect(pick({ q: "대구일중" })).toEqual(["r:r1"]);
    // 웹 보고서도 반 이름으로 찾는다(검색 안내 '학생·학교·반') — 요청 당시 수강 반.
    const withClass = build([report({ snapshot: { ...report().snapshot, courses: [{ id: "e", classId: "c", className: "중2 심화A", subject: "math", teacherId: "t1", teacherName: "이성우", startDate: "2026-03-01", endDate: null, onHold: false }] } })], []);
    const f = parseListFilters({ q: "심화A" }, true);
    expect(keys(filterListItems(withClass, f, listWindow(f, "2026-10-14")))).toEqual(["r:r1"]);
  });

  it("작성 강사 선택지 = 목록에 나온 이름만, 이름 모름·퇴직자 묶음은 빼고 한국어 정렬", () => {
    const items = build([report(), report({ id: "r2", teacher_id: "gone" })], [archive({ teacher_name: "" }), archive({ id: "a2", teacher_name: "Jane" })]);
    // 한국어 정렬은 한글이 로마자보다 앞이다([[#84]]) — 원문 영어 이름은 뒤로.
    expect(teacherOptions(items, staff).map((o) => o.value)).toEqual(["이성우", "Jane"]);
  });

  it("작성 강사 선택지 — 퇴사자는 재직자 뒤 별도 묶음이다", () => {
    const items = build([report()], [archive({ teacher_name: "가나다" }), archive({ id: "a2", teacher_name: "Jane" })]);
    expect(teacherOptions(items, staff)).toEqual([
      { value: "이성우", label: "이성우" },
      { value: "가나다", label: "가나다", group: "퇴사자" },
      { value: "Jane", label: "Jane", group: "퇴사자" },
    ]);
  });

  it("목록 주소 — 창(embed)을 지키고 쪽은 처음으로", () => {
    expect(listHref({ embed: "1", page: "3", status: "pending" }, { kind: "withdrawal", status: null })).toBe(
      "/withdrawal-reports?embed=1&kind=withdrawal",
    );
    expect(listHref({}, {})).toBe("/withdrawal-reports");
  });
});

describe("원장 2026-10-30 — 내 승인 구분 · 요청일 정렬 · 구분/내 승인 필터 · 내용 검색", () => {
  const as = (userId: string, reports: ReportListRow[], archives: ArchiveRow[] = []) => buildListItems({ reports, archives, staff, labelOf, userId });
  it("상태 칸 구분 — 내 승인 차례 / 관여했지만 할 일 없음 / 승인자가 아닌 열람", () => {
    const r = report({ status: "manager_pending", manager_ids: ["m1", "m2"], manager_decisions: { m2: "2026-10-11" } });
    expect(as("m1", [r])[0]!.mine).toBe("approve");
    expect(as("m2", [r])[0]!.mine).toBe("none"); // 이미 승인함
    expect(as("boss", [r])[0]!.mine).toBe("view");
    const d = report({ status: "director_pending", director_ids: ["boss"], director_decisions: {} });
    expect(as("boss", [d])[0]!.mine).toBe("approve");
    expect(as("m1", [d])[0]!.mine).toBe("none"); // 관리자 단계는 끝났다
  });
  it("처리되지 않은 것 먼저, 그 안에선 요청일 최신 순 · 처리 완료는 그 아래 · 요청일 없는 기존 기록은 그 뒤", () => {
    const items = build(
      [
        report({ id: "old-pending", created_at: "2026-10-01T00:00:00Z", effective_date: "2026-12-01" }),
        report({ id: "new-pending", created_at: "2026-10-20T00:00:00Z", effective_date: "2026-10-05" }),
        report({ id: "done", status: "completed", created_at: "2026-10-25T00:00:00Z" }),
      ],
      [archive({ exit_date: "2026-10-28" })],
    );
    expect(keys(items)).toEqual(["r:new-pending", "r:old-pending", "r:done", "a:a1"]);
  });
  it("구분 필터 · 내 승인 필터 · 본문 내용 검색(상담 내용·원본 칸)", () => {
    const items = as("m1", [
      report({ id: "w", status: "manager_pending", body_parent: "어머님이 이사 계획을 말씀하셨다" }),
      report({ id: "s", exit_kind: "subject_end", status: "director_pending", director_ids: ["boss"] }),
    ], [archive({ search_fields: { 상담내용: "숙제 부담으로 그만둠" } })]);
    const win = listWindow(all, "2026-10-30");
    expect(keys(filterListItems(items, { ...all, kind: "subject_end" }, win))).toEqual(["r:s"]);
    expect(keys(filterListItems(items, { ...all, mine: true }, win))).toEqual(["r:w"]);
    expect(keys(filterListItems(items, { ...all, q: "이사 계획" }, win))).toEqual(["r:w"]);
    expect(keys(filterListItems(items, { ...all, q: "숙제 부담" }, win))).toEqual(["a:a1"]);
    expect(parseListFilters({ kind: "subject_end", mine: "approve" }, true)).toMatchObject({ kind: "subject_end", mine: true });
    expect(parseListFilters({ kind: "x" }, true)).toMatchObject({ kind: "all", mine: false });
  });
});

describe("원장 2026-11-03 — 관리자 승인 생략 · 데스크 환불 단계 · 원장 칸 없음", () => {
  const as = (userId: string, reports: ReportListRow[], refunds?: Map<string, { documentId: string; deskId: string | null; deskName: string; completedDate: string | null }[]>) =>
    buildListItems({ reports, archives: [], staff, labelOf, userId, refunds });
  it("관리자 0명 보고서는 '작성 강사 · 승인 생략' 한 줄(직급이 비면 '관리자 이름') · 원장 줄·'관리자가 최종 승인' 줄은 없다", () => {
    const [skip] = as("t1", [report({ manager_id: null, manager_ids: [], status: "requested" })]);
    expect(skip!.approval).toEqual([{ text: "관리자 이성우 · 승인 생략", muted: true }]);
    const [normal] = as("t1", [report()]);
    expect(normal!.approval).toEqual([{ text: "관리자 ○ 관리자" }]);
    expect(filterListItems([skip!], { ...all, q: "관리자 승인 생략" }, listWindow(all, "2026-11-03"))).toHaveLength(1);
  });
  it("직급으로 적는다(원장 2026-11-05 '정유진 부원장') — 승인자 · 생략 · 바로 처리 · 옛 원장 줄 · 직급이 비면 종전 표기", () => {
    const titled: StaffOption[] = [
      { id: "kg", name: "김그린", role: "admin", subjects: ["english"], jobTitle: null },
      { id: "jy", name: "정유진", role: "admin", subjects: ["english"], jobTitle: "부원장" },
      { id: "he", name: "허은진", role: "admin", subjects: ["math"], jobTitle: "부원장" },
      { id: "wi", name: "원일", role: "master", subjects: [], jobTitle: "대표" },
      { id: "t", name: "강사", role: "teacher", subjects: ["english"], jobTitle: "  " },
    ];
    const rows = (r: Partial<ReportListRow>) => buildListItems({ reports: [report({ teacher_id: "t", requested_by: "jy", ...r })], archives: [], staff: titled, labelOf, userId: "x" })[0]!;
    expect(rows({ manager_id: "jy", manager_ids: ["jy", "he"], manager_decisions: { jy: "2026-11-05" } }).approval).toEqual([{ text: "✓ 정유진 부원장 · ○ 허은진 부원장" }]);
    // 직급이 빈 사람이 끼면 종전 모양('관리자 ○ 이름') — 직급 있는 사람은 이름 뒤에 직급.
    expect(rows({ manager_id: "kg", manager_ids: ["kg", "jy"] }).approval).toEqual([{ text: "관리자 ○ 김그린 · ○ 정유진 부원장" }]);
    expect(rows({ manager_id: "kg", manager_ids: ["kg"] }).approval).toEqual([{ text: "관리자 ○ 김그린" }]);
    // 승인 생략 — 작성 강사 본인과 생략 사실.
    expect(rows({ teacher_id: "jy", manager_id: null, manager_ids: [], status: "requested" }).approval).toEqual([{ text: "정유진 부원장 · 승인 생략", muted: true }]);
    expect(rows({ teacher_id: "kg", manager_id: null, manager_ids: [], status: "requested" }).approval).toEqual([{ text: "관리자 김그린 · 승인 생략", muted: true }]);
    // 공백뿐인 직급은 없는 것으로 · 바로 처리 줄 · 옛 보고서의 원장 줄(동작은 그대로, 표기만).
    expect(rows({ manager_id: "t", manager_ids: ["t"] }).approval).toEqual([{ text: "관리자 ○ 강사" }]);
    expect(rows({ teacher_id: "jy", manager_id: "jy", manager_ids: ["jy"], requested_by: "jy" }).approval[0]).toEqual({ text: "관리자 바로 처리 · 정유진 부원장" });
    // 원장 단계가 있는 옛 보고서는 직급이 있어도 '관리자'·'원장' 머리말을 남긴다(두 단계 구분 — 리뷰 2026-11-06).
    expect(rows({ manager_id: "jy", manager_ids: ["jy"], director_id: "wi", director_ids: ["wi"] }).approval).toEqual([{ text: "관리자 ○ 정유진 부원장" }, { text: "원장 ○ 원일 대표" }]);
    // 검색은 보이는 표기로도 — '정유진 부원장'·'원일 대표'·생략 줄(리뷰 2026-11-06).
    const win = listWindow(all, "2026-11-05");
    const found = (r: Partial<ReportListRow>, q: string) => filterListItems([rows(r)], { ...all, q }, win).length;
    expect(found({ manager_id: "he", manager_ids: ["he"] }, "허은진 부원장")).toBe(1);
    expect(found({ manager_id: "jy", manager_ids: ["jy"], director_id: "wi", director_ids: ["wi"] }, "원일 대표")).toBe(1);
    expect(found({ teacher_id: "jy", manager_id: null, manager_ids: [], status: "requested" }, "정유진 부원장 · 승인 생략")).toBe(1);
    expect(found({ manager_id: "he", manager_ids: ["he"] }, "정유진 부원장")).toBe(1); // 요청자(정유진)
    expect(found({ manager_id: "kg", manager_ids: ["kg"], requested_by: "kg" }, "부원장")).toBe(0);
    // 작성 강사 칸·강사 필터는 이름 그대로(다른 표기를 건드리지 않는다).
    expect(rows({ teacher_id: "jy", manager_id: "he", manager_ids: ["he"] }).teacher).toBe("정유진");
  });
  it("데스크 환불이 남으면 상태 글에 '데스크 환불 요청' · 환불 단계 desk · 승인 진행에 데스크 줄(○ 대기 / ✓ 완료 · 담당 이름 — 2026-11-06부터 머리말 없이 이름 직급만)", () => {
    const steps = new Map([["g1", [{ documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null }]]]);
    const [w] = as("m1", [report({ group_id: "g1", status: "manager_pending" })], steps);
    expect(w!.statusLabel).toBe("관리자 요청 · 데스크 환불 요청"); // 원장 2026-11-06 '관리자 승인 요청' → '관리자 요청'
    expect(w!.refundStage).toBe("desk");
    expect(w!.approval.at(-1)).toEqual({ text: "○ 데스크A" });
    expect(w!.mine).toBe("approve");
    expect(w!.deskTurn).toBeUndefined(); // 관리자 차례가 먼저다
    const done = new Map([["g1", [{ documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: "2026-11-03" }]]]);
    const [d] = as("m1", [report({ group_id: "g1", status: "completed" })], done);
    expect(d!.statusLabel).toBe("처리 완료");
    expect(d!.refundStage).toBeNull(); // 끝난 보고서엔 기다릴 환불이 없다
    expect(d!.approval.at(-1)).toEqual({ text: "✓ 데스크A" });
  });
  it("데스크 담당자의 차례 — '내 승인 필요' 필터에 들고 표시는 데스크 차례", () => {
    const steps = new Map([["g1", [{ documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null }]]]);
    const [w] = as("desk", [report({ group_id: "g1", status: "approved", manager_decisions: { m1: "2026-11-03" } })], steps);
    expect(w).toMatchObject({ mine: "approve", deskTurn: true, statusLabel: "관리자 승인 완료 · 데스크 환불 요청" });
    const win = listWindow(all, "2026-11-03");
    expect(filterListItems([w!], { ...all, mine: true }, win)).toHaveLength(1);
    expect(filterListItems([w!], { ...all, q: "데스크A" }, win)).toHaveLength(1);
    // 읽기 전용 보기면 차례를 세우지 않는다
    expect(buildListItems({ reports: [report({ group_id: "g1", status: "approved" })], archives: [], staff, labelOf, userId: "desk", refunds: steps, writable: false })[0]!.mine).not.toBe("approve");
  });
});

describe("원장 2026-11-06 시안 A — 상태 칸 3단계 막대(reportProgress)", () => {
  const flow = (over: Partial<ReportFlow> = {}): ReportFlow => ({
    status: "requested", othersPending: false, effectiveDate: "2026-11-20", appliedAt: null, updatedAt: "2026-11-04T16:30:00Z", canCancel: false, ...over,
  });
  const progress = (f: Partial<ReportFlow>, over: Partial<ListItem> = {}): ReportProgress =>
    reportProgress({ href: "/withdrawal-reports/r1", mine: "none", myTurn: false, flow: flow(f), ...over })!;
  const names = (p: ReportProgress) => p.names.map((n) => n.state);
  const notes = (p: ReportProgress) => p.notes.map((n) => n.text);
  type Step = { documentId: string; deskId: string | null; deskName: string; completedDate: string | null };
  const refundMap = (key: string, ...steps: Step[]) => new Map([[key, steps]]);

  it("진행 중 상태마다 지금 단계 · 칸 · 추가 정보 — 막대와 겹치는 '작성 요청'·'관리자 요청'은 쓰지 않는다", () => {
    const cases: [Partial<ReportFlow>, Partial<ListItem>, string[], string[], string][] = [
      [{ status: "requested" }, {}, ["now", "todo", "todo"], [], "진행 1/3단계 · 강사 작성"],
      [{ status: "revision" }, {}, ["alert", "todo", "todo"], ["반려 · 수정 요청"], "진행 1/3단계 · 강사 작성 — 반려 · 수정 요청"],
      [{ status: "manager_pending" }, {}, ["done", "now", "todo"], [], "진행 2/3단계 · 관리자 승인"],
      [{ status: "director_pending" }, {}, ["done", "now", "todo"], ["원장 승인 대기"], "진행 2/3단계 · 관리자 승인 — 원장 승인 대기"], // 옛 원장 단계 = 2단계
      // 승인 완료 — 같은 묶음에 승인 전 과목이 남았으면 2단계(환불이 걸려 있어도 앞지르지 않는다 · 리뷰 2026-11-06)
      [{ status: "approved", othersPending: true }, {}, ["done", "now", "todo"], ["다른 과목 승인 대기"], "진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기"],
      [{ status: "approved", othersPending: true }, { refundStage: "desk" }, ["done", "now", "todo"], ["다른 과목 승인 대기", "데스크 환불 대기"], "진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기 · 데스크 환불 대기"],
      [{ status: "approved", othersPending: true }, { refundStage: "decision" }, ["done", "now", "todo"], ["다른 과목 승인 대기", "환불 결정 대기"], "진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기 · 환불 결정 대기"],
      // 다 승인됐으면 3단계 — 환불만 남았거나, 환불까지 끝나 처리만 남음
      [{ status: "approved" }, { refundStage: "desk" }, ["done", "done", "now"], ["데스크 환불 대기"], "진행 3/3단계 · 처리 완료 — 데스크 환불 대기"],
      [{ status: "approved" }, { refundStage: "decision" }, ["done", "done", "now"], ["환불 결정 대기"], "진행 3/3단계 · 처리 완료 — 환불 결정 대기"],
      [{ status: "approved" }, {}, ["done", "done", "now"], [], "진행 3/3단계 · 처리 완료"],
      [{ status: "manager_pending" }, { refundStage: "desk" }, ["done", "now", "todo"], ["데스크 환불 대기"], "진행 2/3단계 · 관리자 승인 — 데스크 환불 대기"], // 승인 전 환불은 2단계 그대로
      [{ status: "scheduled" }, {}, ["done", "done", "now"], ["처리 예약 · 11-20"], "진행 3/3단계 · 처리 완료 — 처리 예약 · 11-20"],
      [{ status: "scheduled" }, { refundStage: "desk" }, ["done", "done", "now"], ["처리 예약 · 11-20", "데스크 환불 대기"], "진행 3/3단계 · 처리 완료 — 처리 예약 · 11-20 · 데스크 환불 대기"],
      [{ status: "blocked" }, { refundStage: "desk" }, ["done", "done", "alert"], ["수강 변경 · 재검토 필요 — 취소 후 다시 요청"], "진행 3/3단계 · 처리 완료 — 수강 변경 · 재검토 필요 — 취소 후 다시 요청"], // 재검토엔 환불 대기가 없다
    ];
    for (const [f, over, cells, said, label] of cases) {
      const p = progress(f, over);
      expect(p.cells, label).toEqual(cells);
      expect(names(p), label).toEqual(cells); // 진행 중엔 단계 이름이 칸과 같은 상태
      expect(notes(p), label).toEqual(said);
      expect(p.label).toBe(label);
      expect(p.names.map((n) => n.text)).toEqual(["강사 작성", "관리자 승인", "처리 완료"]);
    }
    expect(progress({ status: "revision" }).notes[0]!.tone).toBe("alert");
    expect(progress({ status: "blocked" }).notes[0]!.tone).toBe("alert");
    expect(progress({ status: "approved", othersPending: true }).notes[0]!.tone).toBe("plain");
    expect(progress({ status: "manager_pending", othersPending: true }).cells).toEqual(["done", "now", "todo"]); // 형제 대기는 승인 완료 줄에만 쓴다
  });

  it("처리 완료 — 세 칸 모두 채움 · 이름은 '처리 완료'만 굵게 · 처리일(KST, 처리 시각) 초록 · 꼬리 없음", () => {
    const p = progress({ status: "completed", appliedAt: "2026-11-04T15:30:00Z", updatedAt: "2026-11-09T00:00:00Z" }, { mine: "view", myTurn: true });
    expect(p.step).toBe(3);
    expect(p.cells).toEqual(["done", "done", "done"]);
    expect(names(p)).toEqual(["done", "done", "now"]);
    expect(p.notes).toEqual([{ text: "처리일 11-05", tone: "done" }]); // UTC 11-04 15:30 = KST 11-05 00:30
    expect(p.tail).toBeNull();
    expect(p.label).toBe("3단계 모두 완료 — 처리일 11-05");
  });

  it("요청 취소 — 세 칸 옅은 회색 · 이름 취소선 · 취소일 · 꼬리 없음 · 취소 기록이 있으면 말풍선(사유 · 사람 · 시각)", () => {
    const plain = progress({ status: "canceled", updatedAt: "2026-11-04T16:30:00Z" }, { mine: "view" });
    expect(plain.step).toBe(0);
    expect(plain.cells).toEqual(["off", "off", "off"]);
    expect(names(plain)).toEqual(["off", "off", "off"]);
    expect(plain.notes).toEqual([{ text: "요청 취소 · 취소일 11-05", tone: "plain" }]); // 취소 기록이 없으면 마지막 변경 시각(KST) · 말풍선 없음
    expect(plain.tail).toBeNull();
    expect(plain.label).toBe("진행 중단 — 요청 취소 · 취소일 11-05");
    const noted = progress({ status: "canceled", updatedAt: "2026-11-09T00:00:00Z" }, { cancel: { reason: " 학부모가 다시 다니기로 함 ", by: "김원장 원장", at: "2026-11-05T05:20:00Z" } });
    expect(noted.notes).toEqual([{ text: "요청 취소 · 취소일 11-05", tone: "plain", cancel: { reason: "학부모가 다시 다니기로 함", meta: "김원장 원장 · 11-05 14:20" } }]);
    for (const reason of [null, "  "]) {
      expect(progress({ status: "canceled" }, { cancel: { reason, by: "정유진 부원장", at: "2026-11-01T23:59:00Z" } }).notes[0]!.cancel).toEqual({ reason: "사유 기록 없음(이전 취소)", meta: "정유진 부원장 · 11-02 08:59" });
    }
  });

  it("지금 단계 뒤 칸은 늘 비운다 — 어느 상태·형제 대기·환불 단계에서도 지금 칸 뒤에 채운 칸이 없다(리뷰 2026-11-06)", () => {
    const statuses = ["requested", "revision", "manager_pending", "director_pending", "approved", "scheduled", "blocked"] as const;
    for (const status of statuses)
      for (const othersPending of [false, true])
        for (const refundStage of [null, "desk", "decision"] as const) {
          const { cells, step } = progress({ status, othersPending }, { refundStage });
          const at = `${status}/${othersPending}/${refundStage}`;
          const now = cells.findIndex((c) => c === "now" || c === "alert");
          expect(now, at).toBe(step - 1);
          expect(cells.slice(0, now), at).toEqual(Array(now).fill("done"));
          expect(cells.slice(now + 1), at).toEqual(Array(2 - now).fill("todo"));
        }
  });

  it("2과목 묶음 — 먼저 승인된 과목은 다른 과목이 승인될 때까지 2단계, 환불이 끝나도 되돌아가지 않는다(리뷰 2026-11-06 재현)", () => {
    const math = report({ id: "r-math", group_id: "g1", subjects: ["math"], status: "approved", manager_decisions: { m1: "2026-11-05" } });
    const eng = report({ id: "r-eng", group_id: "g1", subjects: ["english"], teacher_id: "t2", manager_id: "m2", manager_ids: ["m2"], status: "manager_pending", created_at: "2026-10-09T00:00:00Z" }); // 목록은 요청일 최신 순 — 수학이 위
    const line = (reports: ReportListRow[], completedDate: string | null) =>
      buildListItems({ reports, archives: [], staff, labelOf, userId: "boss", directorLevel: true, groupStatuses: seen(reports), refunds: refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate }) })
        .map((i) => [i.subjects[0], reportProgress(i)!.cells.join("/"), reportProgress(i)!.label]);
    expect(line([math, eng], null)).toEqual([
      ["math", "done/now/todo", "진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기 · 데스크 환불 대기"],
      ["english", "done/now/todo", "진행 2/3단계 · 관리자 승인 — 데스크 환불 대기"],
    ]);
    expect(line([math, eng], "2026-11-06")).toEqual([
      ["math", "done/now/todo", "진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기"],
      ["english", "done/now/todo", "진행 2/3단계 · 관리자 승인"],
    ]);
    // 영어도 승인되면 둘 다 환불만 남은 3단계
    const engDone = { ...eng, status: "approved" as const, manager_decisions: { m2: "2026-11-06" } };
    expect(line([math, engDone], null).map(([, cells, label]) => [cells, label])).toEqual([
      ["done/done/now", "진행 3/3단계 · 처리 완료 — 데스크 환불 대기"],
      ["done/done/now", "진행 3/3단계 · 처리 완료 — 데스크 환불 대기"],
    ]);
  });

  it("형제가 목록에 없는 열람자 — 목록 조회가 실어 온 묶음 상태(groupStatuses)로 판정 · 없으면 보이는 형제로만", () => {
    const math = report({ id: "r-math", group_id: "g1", status: "approved", manager_decisions: { m1: "2026-11-05" } });
    const only = (groupStatuses?: Map<string, { id: string; status: ReportListRow["status"] }[]>) =>
      reportProgress(buildListItems({ reports: [math], archives: [], staff, labelOf, userId: "m1", groupStatuses, refunds: refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null }) })[0]!)!;
    const pending = only(new Map([["g1", [{ id: "r-math", status: "approved" }, { id: "r-eng", status: "manager_pending" }]]]));
    expect(pending.cells).toEqual(["done", "now", "todo"]);
    expect(notes(pending)).toEqual(["다른 과목 승인 대기", "데스크 환불 대기"]);
    for (const status of ["requested", "revision", "director_pending"] as const)
      expect(only(new Map([["g1", [{ id: "r-math", status: "approved" }, { id: "r-eng", status }]]])).step, status).toBe(2);
    expect(only(new Map([["g1", [{ id: "r-math", status: "approved" }, { id: "r-eng", status: "approved" }]]])).step).toBe(3);
    // 형제 조회 실패 · 형제 안 보임 · 환불 대기 → 모른다: 2단계 · '다른 과목 승인 확인 못 함' · 환불 글은 덧붙인다(환불 대기로 형제를 추측하지 않는다 — 리뷰 r2 (a))
    expect(only().label).toBe("진행 2/3단계 · 관리자 승인 — 다른 과목 승인 확인 못 함 · 데스크 환불 대기");
    // 실어 온 묶음 상태가 보이는 줄보다 앞선다
    const eng = report({ id: "r-eng", group_id: "g1", status: "manager_pending" });
    const listed = buildListItems({ reports: [math, eng], archives: [], staff, labelOf, userId: "m1", groupStatuses: new Map([["g1", [{ id: "r-math", status: "approved" }, { id: "r-eng", status: "approved" }]]]) });
    expect(reportProgress(listed.find((i) => i.key === "r:r-math")!)!.step).toBe(3);
  });

  it("형제 조회가 실패하면(groupStatuses 없음) 승인 완료 줄은 2단계 · '다른 과목 승인 확인 못 함' — 환불 대기와 상관없이 3단계로 앞지르지 않는다(재리뷰 2026-11-06 · 리뷰 r2 (a))", () => {
    const math = report({ id: "r-math", group_id: "g1", status: "approved", manager_decisions: { m1: "x" } });
    const teacher = (groupStatuses?: Map<string, { id: string; status: ReportListRow["status"] }[]>, refunds?: Map<string, Step[]>) =>
      reportProgress(buildListItems({ reports: [math], archives: [], staff, labelOf, userId: "t1", groupStatuses, refunds })[0]!)!;
    const pendingMap = new Map([["g1", [{ id: "r-math", status: "approved" as const }, { id: "r-eng", status: "manager_pending" as const }]]]);
    const desk = refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null });
    // 조회 성공 · 영어 승인 전 → 2단계
    expect(teacher(pendingMap).label).toBe("진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기");
    // 조회 실패 · 환불 없음 → 모른다(2단계 · '확인 못 함' — '다른 과목 승인 대기'라고 단정하지 않는다)
    const failed = teacher();
    expect(failed.cells).toEqual(["done", "now", "todo"]);
    expect(failed.label).toBe("진행 2/3단계 · 관리자 승인 — 다른 과목 승인 확인 못 함");
    // 조회 실패 · 데스크 환불 대기 → 그래도 모른다(형제가 안 보이는 관리자에게 3단계로 앞질러 보이던 것 · 리뷰 r2 (a) ③) · 환불 글은 덧붙인다
    expect(teacher(undefined, desk).label).toBe("진행 2/3단계 · 관리자 승인 — 다른 과목 승인 확인 못 함 · 데스크 환불 대기");
    // 조회 실패 · 환불은 끝남 → 2단계 그대로
    expect(teacher(undefined, refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: "2026-11-06" })).step).toBe(2);
    // 조회는 성공했고 형제가 다 승인 → 환불이 없어도 3단계(처리만 남음 — 보조 판정은 조회 실패 때만)
    expect(teacher(new Map([["g1", [{ id: "r-math", status: "approved" as const }, { id: "r-eng", status: "approved" as const }]]])).step).toBe(3);
    // 묶음이 없는 옛 단건은 형제가 없다
    expect(reportProgress(buildListItems({ reports: [report({ status: "approved" })], archives: [], staff, labelOf, userId: "t1" })[0]!)!.step).toBe(3);
  });

  it("🔴 형제 조회 실패 × 대기 까닭 — 승인 완료 줄은 2단계 · '다른 과목 승인 확인 못 함' + 환불 글(결정·데스크·둘 다) · 실제로 승인 전 형제가 보이면 '다른 과목 승인 대기'(리뷰 r2 (a))", () => {
    const math = report({ id: "r-math", group_id: "g1", status: "approved", manager_decisions: { m1: "x" } });
    const eng = report({ id: "r-eng", group_id: "g1", subjects: ["english"], teacher_id: "t2", manager_id: "m2", manager_ids: ["m2"], status: "manager_pending", created_at: "2026-10-09T00:00:00Z" });
    const engDone = { ...eng, status: "approved" as const };
    type Groups = Map<string, { id: string; status: ReportListRow["status"] }[]> | undefined;
    const groups: Record<string, { reports: ReportListRow[]; groupStatuses: Groups }> = {
      "1과목": { reports: [math], groupStatuses: new Map([["g1", [{ id: "r-math", status: "approved" }]]]) },
      "2과목(영어 승인 전)": { reports: [math], groupStatuses: new Map([["g1", [{ id: "r-math", status: "approved" }, { id: "r-eng", status: "manager_pending" }]]]) },
      "조회 실패": { reports: [math], groupStatuses: undefined },
      "조회 실패 · 승인 전 형제가 목록에 보임": { reports: [math, eng], groupStatuses: undefined },
      "조회 실패 · 승인한 형제가 목록에 보임": { reports: [math, engDone], groupStatuses: undefined },
    };
    const desk = refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null });
    const waits: Record<string, Partial<Parameters<typeof buildListItems>[0]>> = {
      결정: { holds: new Map([["g1", "r-math"]]) },
      데스크: { refunds: desk },
      "결정+데스크": { holds: new Map([["g1", "r-math"]]), refunds: desk },
      없음: {},
    };
    const got: Record<string, string> = {};
    for (const [g, { reports, groupStatuses }] of Object.entries(groups))
      for (const [w, extra] of Object.entries(waits)) {
        const item = buildListItems({ reports, archives: [], staff, labelOf, userId: "t1", groupStatuses, ...extra }).find((i) => i.key === "r:r-math")!;
        got[`${g} × ${w}`] = reportProgress(item)!.label;
      }
    const head2 = "진행 2/3단계 · 관리자 승인 — ";
    expect(got).toEqual({
      "1과목 × 결정": "진행 3/3단계 · 처리 완료 — 환불 결정 대기",
      "1과목 × 데스크": "진행 3/3단계 · 처리 완료 — 데스크 환불 대기",
      // 결정 뒤 새 줄로 다시 결정 대기인데 앞 요청서의 데스크 환불도 남음 — 둘 다 쓴다(리뷰 r2 m5 · 데스크에게 '환불 결정 대기'만 보이지 않게)
      "1과목 × 결정+데스크": "진행 3/3단계 · 처리 완료 — 환불 결정 대기 · 데스크 환불 대기",
      "1과목 × 없음": "진행 3/3단계 · 처리 완료",
      "2과목(영어 승인 전) × 결정": `${head2}다른 과목 승인 대기 · 환불 결정 대기`,
      "2과목(영어 승인 전) × 데스크": `${head2}다른 과목 승인 대기 · 데스크 환불 대기`,
      "2과목(영어 승인 전) × 결정+데스크": `${head2}다른 과목 승인 대기 · 환불 결정 대기 · 데스크 환불 대기`,
      "2과목(영어 승인 전) × 없음": `${head2}다른 과목 승인 대기`,
      // 🔴 r1 재현: 결정 대기 → '다른 과목 승인 대기'(1과목인데 단정) · 데스크 대기 → 3단계(형제가 안 보이는 관리자에게 앞질러) — 이제 모두 '확인 못 함'
      "조회 실패 × 결정": `${head2}다른 과목 승인 확인 못 함 · 환불 결정 대기`,
      "조회 실패 × 데스크": `${head2}다른 과목 승인 확인 못 함 · 데스크 환불 대기`,
      "조회 실패 × 결정+데스크": `${head2}다른 과목 승인 확인 못 함 · 환불 결정 대기 · 데스크 환불 대기`,
      "조회 실패 × 없음": `${head2}다른 과목 승인 확인 못 함`,
      // 보이는 형제가 승인 전이면 사실로 안다 — '다른 과목 승인 대기'
      "조회 실패 · 승인 전 형제가 목록에 보임 × 결정": `${head2}다른 과목 승인 대기 · 환불 결정 대기`,
      "조회 실패 · 승인 전 형제가 목록에 보임 × 데스크": `${head2}다른 과목 승인 대기 · 데스크 환불 대기`,
      "조회 실패 · 승인 전 형제가 목록에 보임 × 결정+데스크": `${head2}다른 과목 승인 대기 · 환불 결정 대기 · 데스크 환불 대기`,
      "조회 실패 · 승인 전 형제가 목록에 보임 × 없음": `${head2}다른 과목 승인 대기`,
      // 보이는 형제가 다 승인돼도 안 보이는 형제가 있을 수 있다 — 모른다
      "조회 실패 · 승인한 형제가 목록에 보임 × 결정": `${head2}다른 과목 승인 확인 못 함 · 환불 결정 대기`,
      "조회 실패 · 승인한 형제가 목록에 보임 × 데스크": `${head2}다른 과목 승인 확인 못 함 · 데스크 환불 대기`,
      "조회 실패 · 승인한 형제가 목록에 보임 × 결정+데스크": `${head2}다른 과목 승인 확인 못 함 · 환불 결정 대기 · 데스크 환불 대기`,
      "조회 실패 · 승인한 형제가 목록에 보임 × 없음": `${head2}다른 과목 승인 확인 못 함`,
    });
    // '확인 못 함'은 검색에도 그대로(막대 이름·아래 한 줄과 같은 글) · '다른 과목 승인 대기'로는 안 찾아진다
    const failed = buildListItems({ reports: [math], archives: [], staff, labelOf, userId: "t1", groupStatuses: undefined })[0]!;
    expect(failed.search).toContain("다른 과목 승인 확인 못 함");
    expect(failed.search).not.toContain("다른 과목 승인 대기");
    expect(failed.flow).toMatchObject({ othersPending: false, othersUnknown: true });
    // 승인 완료가 아닌 줄 · 묶음 없는 옛 단건은 조회 실패와 무관(모름 표시 없음)
    expect(buildListItems({ reports: [{ ...math, status: "manager_pending" }], archives: [], staff, labelOf, userId: "t1" })[0]!.flow!.othersUnknown).toBeUndefined();
    expect(buildListItems({ reports: [report({ status: "approved" })], archives: [], staff, labelOf, userId: "t1" })[0]!.flow!.othersUnknown).toBeUndefined();
    // 처리 완료·취소·재검토 줄은 단계가 상태대로(모름 표시 없음)
    expect(reportProgress(buildListItems({ reports: [{ ...math, status: "blocked" }], archives: [], staff, labelOf, userId: "t1", holds: new Map([["g1", "r-math"]]) })[0]!)!.label)
      .toBe("진행 3/3단계 · 처리 완료 — 수강 변경 · 재검토 필요 — 취소 후 다시 요청");
  });

  it("관리자 바로 처리 — 칸은 상태대로 · 아래 한 줄에 '관리자 바로 처리'를 쓰지 않는다(승인 진행 칸과 겹침 · 리뷰 2026-11-06)", () => {
    const direct = (r: Partial<ReportListRow>) => buildListItems({ reports: [report({ teacher_id: "m1", manager_id: "m1", requested_by: "m1", ...r })], archives: [], staff, labelOf, userId: "x" })[0]!;
    const scheduled = direct({ status: "scheduled", effective_date: "2026-11-25" });
    expect(scheduled.approval[0]!.text).toBe("관리자 바로 처리 · 관리자");
    expect(reportProgress(scheduled)!.cells).toEqual(["done", "done", "now"]);
    expect(notes(reportProgress(scheduled)!)).toEqual(["처리 예약 · 11-25"]);
    expect(notes(reportProgress(direct({ status: "completed", applied_at: "2026-11-05T01:00:00Z" }))!)).toEqual(["처리일 11-05"]);
    expect(reportProgress(direct({ status: "canceled" }))!.cells).toEqual(["off", "off", "off"]);
  });

  it("관리자 승인 생략 — 작성 중엔 2칸을 비우고, 제출해 다음 단계로 넘어가면 채운다(이유는 승인 진행 칸 '승인 생략')", () => {
    const skip = (r: Partial<ReportListRow>, extra: ReportListRow[] = [], refunds?: Map<string, Step[]>) => {
      const reports = [report({ manager_id: null, manager_ids: [], group_id: "g1", ...r }), ...extra];
      return reportProgress(buildListItems({ reports, archives: [], staff, labelOf, userId: "x", refunds, groupStatuses: seen(reports) })[0]!)!;
    };
    const writing = skip({ status: "requested" });
    expect(writing.cells).toEqual(["now", "todo", "todo"]);
    expect(names(writing)).toEqual(["now", "todo", "todo"]);
    expect(writing.label).toBe("진행 1/3단계 · 강사 작성");
    expect(skip({ status: "revision" }).cells).toEqual(["alert", "todo", "todo"]);
    // 제출 = 승인 완료 — 혼자면 처리 예약·데스크 환불로(2칸 채움), 다른 과목을 기다리면 보통 보고서처럼 묶음의 승인 단계
    expect(skip({ status: "scheduled" }).cells).toEqual(["done", "done", "now"]);
    expect(skip({ status: "approved" }, [], refundMap("g1", { documentId: "d1", deskId: "desk", deskName: "데스크A", completedDate: null })).cells).toEqual(["done", "done", "now"]);
    expect(skip({ status: "approved" }, [report({ id: "r2", group_id: "g1", status: "manager_pending", created_at: "2026-10-01T00:00:00Z" })]).cells).toEqual(["done", "now", "todo"]);
  });

  it("꼬리 — 내 할 일은 링크(승인 · 환불 · 작성 · 재요청) · 할 일 없는 열람은 '승인 대상 아님' · 관여만 했으면 없음", () => {
    const href = "/withdrawal-reports/r1";
    expect(progress({ status: "manager_pending" }, { mine: "approve" }).tail).toEqual({ text: "내 승인 필요", href });
    expect(progress({ status: "approved" }, { mine: "approve", deskTurn: true, refundStage: "desk" }).tail).toEqual({ text: "내 환불 처리 필요", href });
    // 데스크 화면이 있으면 그 환불 요청서로 — 수납 메뉴라 새 창
    expect(progress({ status: "approved" }, { mine: "approve", deskTurn: true, refundStage: "desk", deskHref: "/billing/refunds/d1" }).tail).toEqual({ text: "내 환불 처리 필요", href: "/billing/refunds/d1", newWindow: true });
    expect(progress({ status: "approved" }, { mine: "approve", deskTurn: true, deskHref: "" }).tail).toEqual({ text: "내 환불 처리 필요", href });
    expect(progress({ status: "requested" }, { myTurn: true }).tail).toEqual({ text: "내 작성 대기", href });
    expect(progress({ status: "revision" }, { myTurn: true }).tail).toEqual({ text: "내 작성 대기", href });
    expect(progress({ status: "blocked", canCancel: true }, { mine: "view" }).tail).toEqual({ text: "내 재요청 필요", href }); // 원장급 열람도 취소할 수 있으면 할 일
    expect(progress({ status: "blocked", canCancel: false }, { mine: "view" }).tail).toEqual({ text: "승인 대상 아님", href: null });
    expect(progress({ status: "scheduled", canCancel: true }).tail).toBeNull(); // 재요청은 재검토 건만
    expect(progress({ status: "manager_pending" }, { mine: "view" }).tail).toEqual({ text: "승인 대상 아님", href: null });
    expect(progress({ status: "manager_pending" }, { mine: "none" }).tail).toBeNull();
    expect(progress({ status: "completed" }, { mine: "approve" }).tail).toBeNull();
    expect(progress({ status: "canceled" }, { myTurn: true }).tail).toBeNull();
  });

  it("기존 기록(스프레드시트)은 막대가 없다", () => {
    const [old] = build([], [archive()]);
    expect(old!.flow).toBeUndefined();
    expect(reportProgress(old!)).toBeNull();
  });

  it("목록 한 벌이 막대 재료를 채운다 — 처리·변경 시각 · 환불 단계 · 재요청 자격(요청자 · 원장급 · 쓰기 권한)", () => {
    const one = (r: Partial<ReportListRow>, userId = "t1", extra: { directorLevel?: boolean; writable?: boolean } = {}) =>
      buildListItems({ reports: [report(r)], archives: [], staff, labelOf, userId, ...extra })[0]!;
    expect(one({ status: "completed", applied_at: "2026-11-05T01:00:00Z", updated_at: "2026-11-06T00:00:00Z" }).flow).toEqual({
      status: "completed", othersPending: false, effectiveDate: "2026-10-10", appliedAt: "2026-11-05T01:00:00Z", updatedAt: "2026-11-06T00:00:00Z", canCancel: false,
    });
    expect(one({}).refundStage).toBeNull();
    expect(one({}).deskHref).toBeNull();
    expect(one({ status: "manager_pending", group_id: "g9" }).flow!.othersPending).toBe(false); // 자기 자신은 형제가 아니다
    // 재검토 건 — 요청자(m1)와 원장급은 '내 재요청 필요', 그 밖·읽기 전용은 아니다
    const blocked = { status: "blocked" as const };
    expect(reportProgress(one(blocked, "m1"))!.tail).toEqual({ text: "내 재요청 필요", href: "/withdrawal-reports/r1" });
    expect(reportProgress(one(blocked, "boss", { directorLevel: true }))!.tail).toEqual({ text: "내 재요청 필요", href: "/withdrawal-reports/r1" });
    expect(reportProgress(one(blocked, "boss"))!.tail).toEqual({ text: "승인 대상 아님", href: null });
    expect(reportProgress(one(blocked, "m1", { writable: false }))!.tail).toBeNull();
    // 승인 차례 · 작성 차례가 목록에서 그대로 꼬리가 된다
    expect(reportProgress(one({ status: "manager_pending" }, "m1"))!.tail).toEqual({ text: "내 승인 필요", href: "/withdrawal-reports/r1" });
    expect(reportProgress(one({ status: "requested" }, "t1"))!.tail).toEqual({ text: "내 작성 대기", href: "/withdrawal-reports/r1" });
  });

  it("'내 작성 대기'도 쓰기 권한이 있을 때만 — 읽기 전용 보기의 작성 강사는 꼬리 없음(관여자라 '승인 대상 아님'도 아님 · 리뷰 2026-11-06)", () => {
    const mine = (writable: boolean, status: "requested" | "revision") => buildListItems({ reports: [report({ status })], archives: [], staff, labelOf, userId: "t1", writable })[0]!;
    for (const status of ["requested", "revision"] as const) {
      expect(mine(true, status).myTurn).toBe(true);
      expect(mine(false, status).myTurn).toBe(false);
      expect(mine(false, status).mine).toBe("none");
      expect(reportProgress(mine(false, status))!.tail).toBeNull();
    }
  });

  it("데스크 담당자 — 승인 완료 · 데스크 환불 대기 = 3단계 · '내 환불 처리 필요'는 내 몫·완료 전 요청서 중 가장 먼저 만든 것으로(새 창)", () => {
    const steps = refundMap("g1",
      { documentId: "d0", deskId: "desk", deskName: "데스크A", completedDate: "2026-11-04" }, // 끝난 내 몫
      { documentId: "d1", deskId: "other", deskName: "데스크B", completedDate: null }, // 다른 데스크 몫
      { documentId: "d2", deskId: "desk", deskName: "데스크A", completedDate: null },
      { documentId: "d3", deskId: "desk", deskName: "데스크A", completedDate: null });
    const at = (userId: string, writable = true) =>
      buildListItems({ reports: [report({ group_id: "g1", status: "approved", manager_decisions: { m1: "2026-11-03" } })], archives: [], staff, labelOf, userId, refunds: steps, writable,
        groupStatuses: seen([report({ group_id: "g1", status: "approved" })]) })[0]!;
    const desk = at("desk");
    expect(desk.deskHref).toBe("/billing/refunds/d2");
    const p = reportProgress(desk)!;
    expect(p.cells).toEqual(["done", "done", "now"]);
    expect(p.notes.map((n) => n.text)).toEqual(["데스크 환불 대기"]);
    expect(p.tail).toEqual({ text: "내 환불 처리 필요", href: "/billing/refunds/d2", newWindow: true });
    expect(at("other").deskHref).toBe("/billing/refunds/d1");
    expect(at("m1").deskHref).toBeNull(); // 데스크 차례가 아니면 없음
    expect(at("desk", false).deskHref).toBeNull(); // 읽기 전용 보기
  });

  it("상태 칸에 보이는 글로도 찾는다 — 상태 이름 · 아래 한 줄 조각 · 꼬리('보이는 칸은 다 검색' · 리뷰 2026-11-06)", () => {
    const win = listWindow(all, "2026-11-06");
    const items = buildListItems({
      reports: [
        report({ id: "mp", status: "manager_pending" }),
        report({ id: "ap", group_id: "g1", status: "approved", manager_decisions: { m1: "x" } }),
        report({ id: "ap2", group_id: "g1", status: "manager_pending", teacher_id: "t2", created_at: "2026-10-01T00:00:00Z" }),
        report({ id: "sc", status: "scheduled", effective_date: "2026-11-20" }),
        report({ id: "bl", status: "blocked" }),
        report({ id: "dn", status: "completed", applied_at: "2026-11-05T01:00:00Z" }),
        report({ id: "cx", status: "canceled", updated_at: "2026-11-04T01:00:00Z" }),
        report({ id: "rf", group_id: "g2", status: "scheduled", effective_date: "2026-11-21" }),
      ],
      archives: [], staff, labelOf, userId: "viewer",
      refunds: refundMap("g2", { documentId: "d9", deskId: "desk", deskName: "데스크A", completedDate: null }),
    });
    const found = (q: string) => keys(filterListItems(items, { ...all, hideCanceled: false, q }, win)).sort();
    expect(found("관리자 요청")).toEqual(["r:ap2", "r:mp"]); // REPORT_STATUS 새 이름
    expect(found("다른 과목 승인 대기")).toEqual(["r:ap"]);
    expect(found("처리 예약 · 11-20")).toEqual(["r:sc"]);
    expect(found("데스크 환불 대기")).toEqual(["r:rf"]);
    expect(found("재검토 필요 — 취소 후 다시 요청")).toEqual(["r:bl"]);
    expect(found("처리일 11-05")).toEqual(["r:dn"]);
    expect(found("요청 취소 · 취소일 11-04")).toEqual(["r:cx"]);
    expect(found("승인 대상 아님")).toEqual(["r:ap", "r:ap2", "r:bl", "r:mp", "r:rf", "r:sc"]); // 열람자의 꼬리
  });
});

describe("원장 2026-11-06 — 승인 진행에 환불 줄(관리자 → 환불 결정 → 데스크 · 이름 직급만) · 환불 단계 · 요청 취소 정보", () => {
  const people: StaffOption[] = [
    { id: "t1", name: "이성우", role: "teacher", subjects: ["math"] },
    { id: "jy", name: "정유진", role: "admin", subjects: ["math"], jobTitle: "부원장" },
    { id: "sh", name: "설현", role: "master", subjects: [], jobTitle: "원장" },
    { id: "wi", name: "원일", role: "master", subjects: [], jobTitle: "대표" },
    { id: "nt", name: "무직급", role: "master", subjects: [], jobTitle: null },
    // 운영자 계정은 표시 역할이 admin이라(reportStaff) 받는 원장급에 들지 않는다.
    { id: "op", name: "운영", role: "admin", subjects: [] },
  ];
  type Step = { documentId: string; deskId: string | null; deskName: string; completedDate: string | null; deskTitle?: string | null; deskActive?: boolean };
  const step = (over: Partial<Step> = {}): Step => ({ documentId: "d1", deskId: "dk", deskName: "홍길동", completedDate: null, deskTitle: "대리", deskActive: true, ...over });
  const row = (over: Partial<ReportListRow> = {}) => report({ group_id: "g1", requested_by: "jy", manager_id: "jy", manager_ids: ["jy"], ...over });
  type Extra = Partial<Parameters<typeof buildListItems>[0]>;
  const one = (r: ReportListRow, extra: Extra = {}, staffList: StaffOption[] = people.filter((p) => p.id !== "nt")) =>
    buildListItems({ reports: [r], archives: [], staff: staffList, labelOf, userId: "x", ...extra })[0]!;
  const win = listWindow(all, "2026-11-06");
  const found = (item: ListItem, q: string) => filterListItems([item], { ...all, q }, win).length;

  it("결정 전 — 관리자 줄 다음에 '○ 받는 원장급'(관리자 줄과 같은 표기 · 운영자 계정 없음) · 환불 단계 decision", () => {
    const w = one(row({ status: "approved", manager_decisions: { jy: "2026-11-06" } }), { holds: new Map([["g1", "r1"]]) });
    expect(w.approval).toEqual([{ text: "✓ 정유진 부원장" }, { text: "○ 설현 원장 · ○ 원일 대표" }]);
    expect(w.refundStage).toBe("decision");
    expect(found(w, "설현 원장")).toBe(1);
    // 직급이 빈 원장급이 끼면 관리자 줄처럼 '원장' 머리말.
    expect(one(row(), { holds: new Map([["g1", null]]) }, people).approval.at(-1)).toEqual({ text: "원장 ○ 설현 원장 · ○ 원일 대표 · ○ 무직급" });
    // 처리가 끝났거나 취소된 보고서엔 결정 대기 줄이 없다.
    expect(one(row({ status: "completed" }), { holds: new Map([["g1", "r1"]]) }).approval).toEqual([{ text: "○ 정유진 부원장" }]);
  });

  it("환불 없음으로 결정 — 흐린 '✓ 결정한 원장' · 환불 단계 없음 · 검색은 이름 직급", () => {
    const w = one(row({ status: "approved" }), { outcomes: new Map([["g1", { outcome: "none" as const, by: "sh", at: "2026-11-06T03:00:00Z" }]]) });
    expect(w.approval.slice(1)).toEqual([{ text: "✓ 설현 원장", muted: true }]);
    expect(w.refundStage).toBeNull();
    expect(found(w, "설현 원장")).toBe(1);
  });

  it("환불 승인 — '✓ 승인한 원장'(흐리지 않음) 다음에 데스크 담당마다 한 줄 · 대기 '○' → 환불완료일자 '✓' · 환불 단계 desk", () => {
    const outcomes = new Map([["g1", { outcome: "refund" as const, by: "wi", at: "2026-11-06T03:00:00Z" }]]);
    const waiting = one(row({ status: "approved" }), { outcomes, refunds: new Map([["g1", [step(), step({ documentId: "d2", deskId: "d2", deskName: "김회계", deskTitle: "주임" })]]]) });
    expect(waiting.approval.slice(1)).toEqual([{ text: "✓ 원일 대표" }, { text: "○ 홍길동 대리" }, { text: "○ 김회계 주임" }]);
    expect(waiting.refundStage).toBe("desk");
    expect(found(waiting, "홍길동 대리")).toBe(1);
    expect(found(waiting, "원일 대표")).toBe(1);
    const done = one(row({ status: "approved" }), { outcomes, refunds: new Map([["g1", [step({ completedDate: "2026-11-06" })]]]) });
    expect(done.approval.slice(1)).toEqual([{ text: "✓ 원일 대표" }, { text: "✓ 홍길동 대리" }]);
    expect(done.refundStage).toBeNull();
    // 결정 뒤 새 줄이 생겨 다시 대기면 원장 줄이 '○'로 돌아가고 데스크 줄은 그대로 · 단계는 결정이 먼저.
    const again = one(row({ status: "approved" }), { outcomes, holds: new Map([["g1", "r1"]]), refunds: new Map([["g1", [step()]]]) });
    expect(again.approval.slice(1)).toEqual([{ text: "○ 설현 원장 · ○ 원일 대표" }, { text: "○ 홍길동 대리" }]);
    expect(again.refundStage).toBe("both"); // 결정 대기 + 데스크 대기 둘 다(리뷰 r2 m5)
  });

  it("원장 차례 — 상태 칸 아래 줄 '환불 결정 대기' · 꼬리 '내 환불 결정 필요'(원장급·쓰기 권한 · 보고서 상세로) · 둘 다 검색 · '내 승인 필요' 필터", () => {
    const holds = new Map([["g1", "r1"]]);
    // 목록 조회가 실어 온 묶음 형제 상태(형제 모두 승인) — 없으면 main 규칙대로 '다른 과목 승인 대기'로 보수적으로 본다.
    const groupStatuses = new Map([["g1", [{ id: "r1", status: "approved" as const }]]]);
    const mine = one(row({ status: "approved", manager_decisions: { jy: "2026-11-06" } }), { holds, userId: "sh", directorLevel: true, groupStatuses });
    expect(mine).toMatchObject({ refundTurn: true, mine: "approve", refundStage: "decision" });
    const p = reportProgress(mine)!;
    expect(p.notes.map((n) => n.text)).toEqual(["환불 결정 대기"]);
    expect(p.tail).toEqual({ text: "내 환불 결정 필요", href: "/withdrawal-reports/r1#refund" }); // 결정 자리로 바로(리뷰 r2 m8)
    expect(found(mine, "내 환불 결정 필요")).toBe(1);
    expect(found(mine, "환불 결정 대기")).toBe(1);
    expect(filterListItems([mine], { ...all, mine: true }, win)).toHaveLength(1);
    // 원장급이 아니면 · 읽기 전용이면 · 결정할 줄을 보이는 보고서가 다른 보고서면 차례가 아니다(아래 줄 '환불 결정 대기'는 그대로)
    const notDirector = one(row({ status: "approved" }), { holds, userId: "sh", directorLevel: false });
    expect(notDirector.refundTurn).toBeUndefined();
    expect(reportProgress(notDirector)!.tail?.text).not.toBe("내 환불 결정 필요");
    expect(reportProgress(notDirector)!.notes.map((n) => n.text)).toContain("환불 결정 대기");
    expect(one(row({ status: "approved" }), { holds, userId: "sh", directorLevel: true, writable: false }).refundTurn).toBeUndefined();
    expect(one(row({ status: "approved" }), { holds: new Map([["g1", "other"]]), userId: "sh", directorLevel: true }).refundTurn).toBeUndefined();
  });

  it("직급이 비면 이름만 · 퇴사(비활성)·지운 담당과 명단에 없는 결정자는 '이전 담당자'", () => {
    const outcomes = new Map([["g1", { outcome: "refund" as const, by: "gone", at: "2026-11-06T03:00:00Z" }]]);
    const w = one(row({ status: "approved" }), { outcomes, refunds: new Map([["g1", [step({ deskTitle: null }), step({ documentId: "d2", deskActive: false }), step({ documentId: "d3", deskId: null })]]]) });
    expect(w.approval.slice(1)).toEqual([{ text: "원장 ✓ 이전 담당자" }, { text: "○ 홍길동" }, { text: "○ 이전 담당자" }, { text: "○ 이전 담당자" }]);
    // 직급을 못 읽은 단계(옛 데이터)는 이름만.
    expect(one(row({ status: "approved" }), { refunds: new Map([["g1", [{ documentId: "d1", deskId: "dk", deskName: "홍길동", completedDate: null }]]]) }).approval.at(-1)).toEqual({ text: "○ 홍길동" });
  });

  it("같은 사람이 단계마다 겹쳐도 줄을 따로 둔다(관리자 → 환불 결정 → 데스크)", () => {
    const w = one(row({ status: "approved", manager_decisions: { jy: "2026-11-06" } }), {
      outcomes: new Map([["g1", { outcome: "refund" as const, by: "sh", at: "2026-11-06T03:00:00Z" }]]),
      refunds: new Map([["g1", [step({ deskId: "sh", deskName: "설현", deskTitle: "원장" })]]]),
    });
    expect(w.approval).toEqual([{ text: "✓ 정유진 부원장" }, { text: "✓ 설현 원장" }, { text: "○ 설현 원장" }]);
  });

  it("환불과 무관하면 줄도 단계도 없다 · 바로 처리 보고서도 같은 자리에 환불 줄", () => {
    const plain = one(row());
    expect(plain.approval).toEqual([{ text: "○ 정유진 부원장" }]);
    expect(plain.refundStage).toBeNull();
    expect(plain.cancel).toBeNull();
    const direct = one(row({ teacher_id: "jy", requested_by: "jy", status: "scheduled" }), { holds: new Map([["g1", "r1"]]) });
    expect(direct.approval).toEqual([{ text: "관리자 바로 처리 · 정유진 부원장" }, { text: "강사 작성 없음", muted: true }, { text: "○ 설현 원장 · ○ 원일 대표" }]);
  });

  it("요청 취소 정보 — 사유 · 취소한 사람(직급 이름) · 시각 · 옛 취소는 사유 null · 취소 안 된 보고서엔 없음 · 사유도 검색", () => {
    const at = "2026-11-06T05:00:00Z";
    const c = one(row({ status: "canceled" }), { cancels: new Map([["r1", { reason: "학부모 요청으로 계속 다님", actorId: "jy", at }]]) });
    expect(c.cancel).toEqual({ reason: "학부모 요청으로 계속 다님", by: "정유진 부원장", at });
    expect(filterListItems([c], { ...all, hideCanceled: false, q: "학부모 요청" }, win)).toHaveLength(1);  // 취소 줄은 기본으로 숨으니 숨김을 끄고
    expect(one(row({ status: "canceled" }), { cancels: new Map([["r1", { reason: null, actorId: "gone", at }]]) }).cancel).toEqual({ reason: null, by: "이전 담당자", at });
    expect(one(row({ status: "canceled" })).cancel).toBeNull(); // 기록을 못 읽었으면 없음(상태 칸은 취소일만)
    expect(one(row({ status: "manager_pending" }), { cancels: new Map([["r1", { reason: "x", actorId: "jy", at }]]) }).cancel).toBeNull();
  });
});
