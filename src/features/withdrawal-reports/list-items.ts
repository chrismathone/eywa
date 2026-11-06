import { inRange, resolveRange, type RangeKey, type RangeWindow } from "@/features/withdrawals/exit-rows";
import { monthRange } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { ArchiveRow } from "./archive-model";
import { archiveReason, webReportReason, type ListReason } from "./list-reason";
import { directorIds, hasJobTitle, isDirectReport, isParticipant, managerIds, managerStepSkipped, refundWaiting, reportStatusChips, titledName, type RefundStep, type ReportListRow, type StaffOption } from "./model";

/**
 * 퇴원보고서 목록 한 벌 — 웹에서 작성·승인하는 보고서와 기존 스프레드시트 보고서(원문 보관)를 **한 목록**에 세운다.
 * 원장 2026-10-14 *"스프레드시트 퇴원보고서를 리스트화 … 따로 볼 필요 없고 미연결 리스트만 따로 보면"* ·
 * *"기간별 조회가능하게 각종 필터 기능도 넣어주고 (다른탭참고)"*. 필터는 퇴원관리처럼 주소(`?status=&range=…`)에 싣는다.
 */

export type ListStatus = "pending" | "completed" | "canceled" | "archive";
export type ListLink = "auto" | "manual" | "unmapped";
export type ListItem = {
  key: string;
  href: string;
  name: string;
  /** 이름 옆 학교학년(원장 2026-10-29 *"학교 학년이 없음. 학생 옆에 붙어줄것"*) — 없으면 빈칸. */
  schoolGrade: string;
  /** 이름 아래 한 줄(처리 구분·과목 / 학교학년·반·과목) — 검색·옛 표면용. 목록 표는 아래 칸들로 나눠 보인다. */
  detail: string;
  /** 목록 열 나누기(원장 2026-10-30 *"과목 열, 이름 열, 학교학년, 상태 열로 4개로 … 영어 / 김덕현 / 성광중2 / 퇴원(혹은 수강종료)"*). */
  subjectText: string;
  /** 퇴원 · 수강종료(원장 *"전체 퇴원 -> 퇴원"*) — 기존 기록(스프레드시트)은 구분이 없어 '—'. */
  kindText: string;
  /** 구분 필터 축 — 기존 기록은 null(구분 필터를 걸면 빠진다). */
  kind: "withdrawal" | "subject_end" | null;
  /** 기존 기록의 반 이름(이름 아래 작게) — 웹 보고서는 빈칸. */
  classText: string;
  /** 기간 필터·정렬 축 = 마지막 수업일(원문에서 날짜를 못 읽은 기록은 null). */
  date: string | null;
  dateText: string;
  /** 요청일(원장 2026-10-29 *"퇴원보고서 요청일 열 추가"*) — 웹 보고서가 만들어진 날(KST). 기존 기록은 알 수 없어 '—'. */
  requestedText: string;
  /** 요청 시각(정렬 축 — 원장 2026-10-30 *"요청일이 있으면 요청일 기준으로 최신 요청이 상단"*) · 기존 기록은 null. */
  requestedAt: string | null;
  teacher: string;
  /** 퇴원 사유 칸 — 우리 사유(대분류 · 세부) · 맞는 것이 없으면 기타 + 설명([`list-reason.ts`](./list-reason.ts)). */
  reason: ListReason;
  subjects: string[];
  status: ListStatus;
  statusLabel: string;
  /** 상태 칩 — 데스크 환불이 남았으면 원래 단계와 '데스크 환불 요청'을 함께(원장 2026-11-03 · `reportStatusChips`). 글은 `statusLabel`과 같다. */
  statusChips: string[];
  tone: "done" | "alert" | "muted";
  approval: { text: string; muted?: boolean }[];
  /** 기존 기록만 — 학생 연결 상태. 웹 보고서는 늘 학생에서 출발하므로 null. */
  link: ListLink | null;
  myTurn: boolean;
  /**
   * 상태 칸 구분(원장 2026-10-30 *"본인의 승인이 필요한 경우와, 승인이 필요하지 않은 경우를 구분 … 상태란을 다르게 표시"*) —
   * `approve` = 지금 내 승인 차례 · `view` = 승인자·요청자·작성자가 아닌 열람 · `none` = 그 밖(관여했지만 지금 할 일 없음).
   */
  mine: "approve" | "view" | "none";
  /** 내 차례가 데스크 환불 처리다(원장 2026-11-03) — 상태 칸 글을 '내 환불 처리 필요'로. 승인 차례와 같은 '내 승인 필요' 필터에 든다. */
  deskTurn?: boolean;
  search: string;
};

export const LIST_PAGE_SIZE = 50;
/** 시각 → KST 날짜(YYYY-MM-DD). */
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
export const LIST_PATH = "/withdrawal-reports";
const NO_TEACHER = "미기재";
const FORMER_STAFF = "이전 담당자";

export function buildListItems(input: {
  reports: readonly ReportListRow[];
  archives: readonly ArchiveRow[];
  staff: readonly StaffOption[];
  labelOf: (key: string) => string;
  userId: string;
  /** 쓰기 권한(읽기 전용 보기면 '내 승인 필요'를 세우지 않는다 — 상세에 승인 버튼이 없다). 기본 true. */
  writable?: boolean;
  /** 데스크 환불 단계(원장 2026-11-03) — 묶음 id(옛 단건은 보고서 id) → 단계(`loadRefundSteps`). 없으면 단계 없음. */
  refunds?: ReadonlyMap<string, readonly RefundStep[]>;
}): ListItem[] {
  const { staff, labelOf, userId } = input;
  const writable = input.writable ?? true;
  const staffOf = (id: string) => staff.find((s) => s.id === id);
  const staffName = (id: string) => staffOf(id)?.name ?? FORMER_STAFF;
  const titledOf = (id: string) => titledName(staffOf(id), FORMER_STAFF);
  // 승인자 줄 — 직급으로 적는다(원장 2026-11-05 *"퇴원 보고서에서는 '부원장'으로 적어줘. 정유진 부원장 등"*): 모두 직급이 있으면
  // '✓ 정유진 부원장 · ○ 허은진 부원장', 직급이 빈 사람이 있으면 종전 모양('관리자 ○ 김그린' — 직급 있는 사람은 이름 뒤에 직급).
  // 원장 단계가 있는 옛 보고서는 직급이 있어도 '관리자'·'원장' 머리말을 남긴다(두 단계를 구분 — 리뷰 2026-11-06).
  const reviewers = (r: ReportListRow, kind: "manager" | "director") => {
    const ids = kind === "manager" ? managerIds(r) : directorIds(r);
    const decisions = kind === "manager" ? r.manager_decisions : r.director_decisions;
    const at = kind === "manager" ? r.manager_approved_at : r.director_approved_at;
    const marks = ids.map((id) => `${decisions?.[id] || at ? "✓" : "○"} ${titledName(staffOf(id), FORMER_STAFF)}`).join(" · ");
    const staged = directorIds(r).length > 0;
    return !staged && ids.length && ids.every((id) => hasJobTitle(staffOf(id))) ? marks : `${kind === "manager" ? "관리자" : "원장"} ${marks}`;
  };
  // 관리자 승인 생략 줄 — 작성 강사 본인과 생략 사실을 함께(원장 2026-11-05 '정유진 부원장 · 승인 생략') · 직급이 비면 '관리자 김그린 · 승인 생략'.
  const skippedBy = (teacherId: string) => {
    const writer = staffOf(teacherId);
    return `${hasJobTitle(writer) ? titledName(writer, FORMER_STAFF) : `관리자 ${staffName(teacherId)}`} · 승인 생략`;
  };
  const web = input.reports.map((r): ListItem => {
    const teacher = staffName(r.teacher_id);
    const reason = webReportReason(r.status, r.body_reason, r.body_detail, r.body_reason_detail);
    // 관리자 바로 처리(강사 작성 없이, 원장 2026-10-23) — 작성자 칸은 처리한 관리자, 승인 칸 대신 '관리자 바로 처리'.
    const direct = isDirectReport(r);
    const steps = input.refunds?.get(r.group_id ?? r.id) ?? [];
    const chips = reportStatusChips(r, steps);
    // 데스크 줄(원장 2026-11-03 '데스크 환불 요청' 단계) — ○ 대기 · ✓ 환불완료일자 입력됨, 담당 이름.
    const desk = steps.length ? [{ text: `데스크 ${steps.map((s) => `${s.completedDate ? "✓" : "○"} ${s.deskName}`).join(" · ")}` }] : [];
    const deskTurn = writable && myDeskTurn(r, steps, userId);
    return {
      key: `r:${r.id}`,
      href: `${LIST_PATH}/${r.id}`,
      name: r.snapshot.name,
      schoolGrade: schoolGradeLabel(r.snapshot.school, r.snapshot.grade),
      detail: `${r.exit_kind === "withdrawal" ? "퇴원" : "수강종료"} · ${r.subjects.length ? r.subjects.map(labelOf).join("·") : "다니는 반 없음"}`,
      subjectText: r.subjects.length ? r.subjects.map(labelOf).join("·") : "다니는 반 없음",
      kindText: r.exit_kind === "withdrawal" ? "퇴원" : "수강종료",
      kind: r.exit_kind,
      classText: "",
      date: r.effective_date,
      dateText: r.effective_date,
      requestedText: kstDay(r.created_at),
      requestedAt: r.created_at,
      teacher,
      reason,
      subjects: r.subjects,
      status: r.status === "completed" ? "completed" : r.status === "canceled" ? "canceled" : "pending",
      statusLabel: chips.join(" · "),
      statusChips: chips,
      tone: r.status === "completed" ? "done" : r.status === "revision" || r.status === "blocked" ? "alert" : "muted",
      approval: [
        ...(direct
          ? [{ text: `관리자 바로 처리 · ${titledName(staffOf(r.requested_by), FORMER_STAFF)}` }, { text: "강사 작성 없음", muted: true }]
          // 관리자 승인 생략(원장 2026-11-03 — 작성 강사가 그 과목 승인 담당) · 원장 칸은 옛 보고서에만.
          : managerStepSkipped(r)
            ? [{ text: skippedBy(r.teacher_id), muted: true }]
            : [{ text: reviewers(r, "manager") }, ...(directorIds(r).length ? [{ text: reviewers(r, "director") }] : [])]),
        ...desk,
      ],
      link: null,
      myTurn: ["requested", "revision"].includes(r.status) && r.teacher_id === userId,
      // 열람 표시는 진행 중에만(끝난 보고서엔 승인할 일이 없다 — 리뷰). 데스크 환불 차례도 내 차례다.
      mine: writable && (myApprovalTurn(r, userId) || deskTurn) ? "approve" : !isParticipant(r, userId) && !["completed", "canceled"].includes(r.status) ? "view" : "none",
      ...(deskTurn && !myApprovalTurn(r, userId) ? { deskTurn: true } : {}),
      // 검색 = 보이는 칸 + 보고서 본문 글 전부(원장 2026-10-30 *"검색은 내용등 모든것을 검색가능하게"*) — 상담 내용·담임 의견·요청 메모·반려 사유·승인자까지.
      search: [r.snapshot.name, r.snapshot.school, r.snapshot.grade, schoolGradeLabel(r.snapshot.school, r.snapshot.grade), ...r.snapshot.courses.map((c) => c.className), teacher, reason.text, reason.note ?? "", direct ? "관리자 바로 처리" : "",
        managerStepSkipped(r) && !direct ? `관리자 승인 생략 ${skippedBy(r.teacher_id)}` : "", ...steps.map((s) => s.deskName),
        // 승인자·요청자는 보이는 표기 그대로(직급 포함 — '정유진 부원장'으로도 찾는다 · 리뷰 2026-11-06).
        r.exit_kind === "withdrawal" ? "퇴원" : "수강종료", ...r.subjects.map(labelOf), chips.join(" "), titledOf(r.requested_by), ...managerIds(r).map(titledOf), ...directorIds(r).map(titledOf),
        r.request_note, r.last_comment ?? "", r.body_detail ?? "", r.body_student ?? "", r.body_parent ?? "", r.body_opinion ?? "", r.body_attendance ?? "", r.body_tuition ?? "", r.body_arrears_note ?? ""].join(" "),
    };
  });
  const archived = input.archives.map((a): ListItem => {
    const className = a.class_name.replace(/\s+/g, " ").trim();
    const reason = archiveReason(a.reason_raw, a.detail_raw);
    return {
      key: `a:${a.id}`,
      href: `${LIST_PATH}/archive/${a.id}`,
      name: a.student_name || "이름 미기재",
      schoolGrade: a.school_grade.trim(),
      detail: [className, a.subject ? labelOf(a.subject) : "과목 미기재"].filter(Boolean).join(" · "),
      subjectText: a.subject ? labelOf(a.subject) : "과목 미기재",
      kindText: "—",
      kind: null,
      classText: className,
      date: a.exit_date,
      dateText: a.exit_date || a.raw_exit_date || "미기재",
      requestedText: "—",
      requestedAt: null,
      teacher: staff.find(s => s.id === a.mapped_teacher_id)?.name || a.teacher_name.trim() || NO_TEACHER,
      reason,
      subjects: a.subject ? [a.subject] : [],
      status: "archive",
      statusLabel: "스프레드시트 기록",
      statusChips: ["스프레드시트 기록"],
      tone: "muted",
      approval: [{ text: `원본 · ${a.sheet_title}`, muted: true }],
      link: a.mapped_student_id ? (a.mapping_kind === "manual" ? "manual" : "auto") : "unmapped",
      myTurn: false,
      mine: "none",
      search: [a.student_name, a.school_grade, a.class_name, a.teacher_name, a.mapped_teacher_id ? staffName(a.mapped_teacher_id) : "", a.sheet_title, reason.text, reason.note ?? "", a.reason_raw ?? "",
        a.subject ? labelOf(a.subject) : "", ...Object.values(a.search_fields ?? {}).map((v) => (typeof v === "string" ? v : ""))].join(" "),
    };
  });
  // 🔑 진행 중(처리할 일)이 먼저 — 기본 보기가 '전체'라 지난 날짜로 요청된 진행 중 보고서가 기존 기록 사이로 묻히지 않게.
  // 그다음 마지막 수업일 늦은 순(날짜 없는 원문은 맨 뒤) → 이름 → 키 — 웹 보고서와 기존 기록이 섞여도 순서가 결정적이다.
  // 원장 2026-10-30 *"처리되지 않은 것이 상단으로. 처리완료는 그 아래 … 요청일 기준으로 최신 요청이 상단"* — 묶음 안에선 요청일 늦은 순,
  // 요청일이 없는 기존 기록은 그 뒤에 마지막 수업일 늦은 순.
  const rank = (i: ListItem) => (i.status === "pending" ? 0 : i.requestedAt === null && i.date === null ? 2 : 1);
  return [...web, ...archived].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(a.requestedAt === null) - Number(b.requestedAt === null) ||
      (b.requestedAt ?? "").localeCompare(a.requestedAt ?? "") ||
      (b.date ?? "").localeCompare(a.date ?? "") ||
      a.name.localeCompare(b.name, "ko") ||
      a.key.localeCompare(b.key),
  );
}

export type ListFilters = {
  status: ListStatus | "all";
  range: RangeKey;
  from: string | null;
  to: string | null;
  subject: string;
  teacher: string;
  /** 구분(원장 2026-10-30 — 퇴원 · 수강종료). */
  kind: "all" | "withdrawal" | "subject_end";
  /** 내 승인 필요만(원장 2026-10-30 "본인의 승인이 필요한 경우 … 구분"). */
  mine: boolean;
  /** 요청 취소 건 숨기기 — 기본 켜짐(원장 2026-11-02). 상태를 따로 고르면 그 상태가 이긴다('요청 취소'를 고르면 보인다). */
  hideCanceled: boolean;
  q: string;
};

const STATUSES: readonly ListStatus[] = ["pending", "completed", "canceled", "archive"];
const RANGES: readonly RangeKey[] = ["month", "30d", "90d", "year", "custom"];

export function parseListFilters(sp: Record<string, string | undefined>, canSeeArchive: boolean): ListFilters {
  const status = STATUSES.find((s) => s === sp.status) ?? "all";
  return {
    // 기존 기록을 못 보는 사람(강사)에겐 그 값도 없다 — 주소에 남아 있어도 전체로.
    status: status === "archive" && !canSeeArchive ? "all" : status,
    range: RANGES.find((r) => r === sp.range) ?? "all",
    from: sp.from ?? null,
    to: sp.to ?? null,
    subject: sp.subject || "all",
    teacher: sp.teacher || "all",
    kind: sp.kind === "withdrawal" || sp.kind === "subject_end" ? sp.kind : "all",
    mine: sp.mine === "approve",
    hideCanceled: sp.canceled !== "show",
    q: (sp.q ?? "").trim(),
  };
}

/**
 * 기간 창 — 계산은 퇴원관리와 같은 함수(`resolveRange`·`inRange`). 단 '이번 달'은 **1일 ~ 말일**이다:
 * 퇴원관리의 이번 달은 오늘까지(퇴원 예정은 아직 퇴원이 아니다)지만, 이 목록은 문서라 이번 달에 처리 예약된 보고서도
 * 이번 달 보고서다. 최근 N일은 오늘까지(앞날짜 보고서는 '전체'·'직접 지정'으로 본다).
 */
export function listWindow(f: ListFilters, today: string): RangeWindow & { custom?: { from: string; to: string } } {
  return resolveRange(f.range, { today, month: monthRange(today.slice(0, 7)), from: f.from, to: f.to });
}

export function filterListItems(items: readonly ListItem[], f: ListFilters, window: RangeWindow): ListItem[] {
  const term = f.q.toLowerCase();
  return items.filter(
    (i) =>
      (f.status === "all" ? !(f.hideCanceled && i.status === "canceled") : i.status === f.status) &&
      inRange({ countDate: i.date, systemBulk: false }, window) &&
      (f.subject === "all" || i.subjects.includes(f.subject)) &&
      (f.teacher === "all" || i.teacher === f.teacher) &&
      (f.kind === "all" || i.kind === f.kind) &&
      (!f.mine || i.mine === "approve") &&
      (!term || i.search.toLowerCase().includes(term)),
  );
}

/** 작성 강사 선택지 — 목록에 실제로 나온 이름만(기존 기록은 원문 이름 그대로). 이름 모름·퇴직자 묶음은 뺀다. */
export function teacherOptions(items: readonly ListItem[], staff: readonly Pick<StaffOption, "name">[]): { value: string; label: string; group?: string }[] {
  const names = new Set(items.map((i) => i.teacher).filter((n) => n && n !== NO_TEACHER && n !== FORMER_STAFF));
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "ko"));
  // 재직자를 먼저, 퇴사자는 맨 아래 별도 묶음으로(원장 2026-10-30) — 검색으로는 찾을 수 있다. 재직자 이름이 아닌 시트 원문 이름도 여기 든다.
  const current = new Set(staff.map((s) => s.name));
  return [...sorted.filter((n) => current.has(n)).map((n) => ({ value: n, label: n })), ...sorted.filter((n) => !current.has(n)).map((n) => ({ value: n, label: n, group: "퇴사자" }))];
}

/**
 * 지금 주소의 값(embed 포함)을 지키며 몇 개만 바꾼 목록 주소 — 값을 바꾸면 쪽은 처음으로.
 * `request`(원생 화면에서 연 요청 창)는 싣지 않는다 — 필터를 바꿀 때마다 창이 다시 열리지 않게.
 */
export function listHref(sp: Record<string, string | undefined>, patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v !== undefined && k !== "page" && k !== "request") params.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const s = params.toString();
  return s ? `${LIST_PATH}?${s}` : LIST_PATH;
}

/** 지금 이 사람의 승인 차례인가 — 관리자 단계면 관리자 명단에 있고 아직 결정 전, 원장 단계(옛 보고서)면 원장 명단에 있고 결정 전(DB 처리 함수와 같은 판정). */
export function myApprovalTurn(r: Pick<ReportListRow, "status" | "manager_id" | "manager_ids" | "director_id" | "director_ids" | "manager_decisions" | "director_decisions">, userId: string): boolean {
  if (r.status === "manager_pending") return managerIds(r).includes(userId) && !r.manager_decisions?.[userId];
  if (r.status === "director_pending") return directorIds(r).includes(userId) && !r.director_decisions?.[userId];
  return false;
}
/**
 * 지금 이 사람의 데스크 환불 차례인가(원장 2026-11-03) — 처리를 기다리는 보고서에 내가 담당인 환불 요청서가 아직 완료 전.
 * 처리는 수납의 환불 요청서에서 한다(환불완료일자) — 내 할 일 '환불 처리'(s2_0011)와 같은 일이다.
 */
export function myDeskTurn(r: Pick<ReportListRow, "status">, steps: readonly RefundStep[], userId: string): boolean {
  return refundWaiting(r, steps) && steps.some((s) => !s.completedDate && s.deskId === userId);
}
