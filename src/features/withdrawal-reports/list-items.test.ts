import { describe, expect, it } from "vitest";
import type { ArchiveRow } from "./archive-model";
import type { ReportListRow, StaffOption } from "./model";
import {
  buildListItems,
  filterListItems,
  listHref,
  listWindow,
  parseListFilters,
  teacherOptions,
  type ListItem,
} from "./list-items";

const staff: StaffOption[] = [
  { id: "t1", name: "이성우", role: "teacher", subjects: ["math"] },
  { id: "m1", name: "관리자", role: "admin", subjects: ["math"] },
];
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

  it("퇴원·종료일 늦은 순, 날짜를 못 읽은 원문은 맨 뒤(원문 표기 그대로 보인다)", () => {
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
