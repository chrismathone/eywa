import { inRange, resolveRange, type RangeKey, type RangeWindow } from "@/features/withdrawals/exit-rows";
import { monthRange } from "@/lib/date-kst";
import type { ArchiveRow } from "./archive-model";
import { archiveReason, webReportReason, type ListReason } from "./list-reason";
import { REPORT_STATUS, directorIds, managerIds, type ReportListRow, type StaffOption } from "./model";

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
  /** 이름 아래 한 줄(처리 구분·과목 / 학교학년·반·과목). */
  detail: string;
  /** 기간 필터·정렬 축 = 퇴원·종료일(원문에서 날짜를 못 읽은 기록은 null). */
  date: string | null;
  dateText: string;
  teacher: string;
  /** 퇴원 사유 칸 — 우리 사유(대분류 · 세부) · 맞는 것이 없으면 기타 + 설명([`list-reason.ts`](./list-reason.ts)). */
  reason: ListReason;
  subjects: string[];
  status: ListStatus;
  statusLabel: string;
  tone: "done" | "alert" | "muted";
  approval: { text: string; muted?: boolean }[];
  /** 기존 기록만 — 학생 연결 상태. 웹 보고서는 늘 학생에서 출발하므로 null. */
  link: ListLink | null;
  myTurn: boolean;
  search: string;
};

export const LIST_PAGE_SIZE = 50;
export const LIST_PATH = "/withdrawal-reports";
const NO_TEACHER = "미기재";
const FORMER_STAFF = "이전 담당자";

export function buildListItems(input: {
  reports: readonly ReportListRow[];
  archives: readonly ArchiveRow[];
  staff: readonly StaffOption[];
  labelOf: (key: string) => string;
  userId: string;
}): ListItem[] {
  const { staff, labelOf, userId } = input;
  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? FORMER_STAFF;
  const reviewers = (r: ReportListRow, kind: "manager" | "director") => {
    const ids = kind === "manager" ? managerIds(r) : directorIds(r);
    const decisions = kind === "manager" ? r.manager_decisions : r.director_decisions;
    const at = kind === "manager" ? r.manager_approved_at : r.director_approved_at;
    return ids.map((id) => `${decisions?.[id] || at ? "✓" : "○"} ${staffName(id)}`).join(" · ");
  };
  const web = input.reports.map((r): ListItem => {
    const teacher = staffName(r.teacher_id);
    const reason = webReportReason(r.status, r.body_reason, r.body_detail, r.body_reason_detail);
    return {
      key: `r:${r.id}`,
      href: `${LIST_PATH}/${r.id}`,
      name: r.snapshot.name,
      detail: `${r.exit_kind === "withdrawal" ? "전체 퇴원" : "수강종료"} · ${r.subjects.map(labelOf).join("·")}`,
      date: r.effective_date,
      dateText: r.effective_date,
      teacher,
      reason,
      subjects: r.subjects,
      status: r.status === "completed" ? "completed" : r.status === "canceled" ? "canceled" : "pending",
      statusLabel: REPORT_STATUS[r.status],
      tone: r.status === "completed" ? "done" : r.status === "revision" || r.status === "blocked" ? "alert" : "muted",
      approval: [
        { text: `관리자 ${reviewers(r, "manager")}` },
        directorIds(r).length ? { text: `원장 ${reviewers(r, "director")}` } : { text: "관리자가 최종 승인", muted: true },
      ],
      link: null,
      myTurn: ["requested", "revision"].includes(r.status) && r.teacher_id === userId,
      search: [r.snapshot.name, r.snapshot.school, r.snapshot.grade, ...r.snapshot.courses.map((c) => c.className), teacher, reason.text, reason.note ?? ""].join(" "),
    };
  });
  const archived = input.archives.map((a): ListItem => {
    const className = a.class_name.replace(/\s+/g, " ").trim();
    const reason = archiveReason(a.reason_raw, a.detail_raw);
    return {
      key: `a:${a.id}`,
      href: `${LIST_PATH}/archive/${a.id}`,
      name: a.student_name || "이름 미기재",
      detail: [a.school_grade, className, a.subject ? labelOf(a.subject) : "과목 미기재"].filter(Boolean).join(" · "),
      date: a.exit_date,
      dateText: a.exit_date || a.raw_exit_date || "미기재",
      teacher: staff.find(s => s.id === a.mapped_teacher_id)?.name || a.teacher_name.trim() || NO_TEACHER,
      reason,
      subjects: a.subject ? [a.subject] : [],
      status: "archive",
      statusLabel: "스프레드시트 기록",
      tone: "muted",
      approval: [{ text: `원본 · ${a.sheet_title}`, muted: true }],
      link: a.mapped_student_id ? (a.mapping_kind === "manual" ? "manual" : "auto") : "unmapped",
      myTurn: false,
      search: [a.student_name, a.school_grade, a.class_name, a.teacher_name, a.mapped_teacher_id ? staffName(a.mapped_teacher_id) : "", a.sheet_title, reason.text, reason.note ?? "", a.reason_raw ?? ""].join(" "),
    };
  });
  // 🔑 진행 중(처리할 일)이 먼저 — 기본 보기가 '전체'라 지난 날짜로 요청된 진행 중 보고서가 기존 기록 사이로 묻히지 않게.
  // 그다음 퇴원·종료일 늦은 순(날짜 없는 원문은 맨 뒤) → 이름 → 키 — 웹 보고서와 기존 기록이 섞여도 순서가 결정적이다.
  const rank = (i: ListItem) => (i.status === "pending" ? 0 : i.date === null ? 2 : 1);
  return [...web, ...archived].sort(
    (a, b) =>
      rank(a) - rank(b) ||
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
  unmapped: boolean;
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
    unmapped: canSeeArchive && sp.link === "unmapped",
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
      (f.status === "all" || i.status === f.status) &&
      (!f.unmapped || i.link === "unmapped") &&
      inRange({ date: i.date, systemBulk: false }, window) &&
      (f.subject === "all" || i.subjects.includes(f.subject)) &&
      (f.teacher === "all" || i.teacher === f.teacher) &&
      (!term || i.search.toLowerCase().includes(term)),
  );
}

/** 작성 강사 선택지 — 목록에 실제로 나온 이름만(기존 기록은 원문 이름 그대로). 이름 모름·퇴직자 묶음은 뺀다. */
export function teacherOptions(items: readonly ListItem[]): { value: string; label: string }[] {
  const names = new Set(items.map((i) => i.teacher).filter((n) => n && n !== NO_TEACHER && n !== FORMER_STAFF));
  return [...names].sort((a, b) => a.localeCompare(b, "ko")).map((n) => ({ value: n, label: n }));
}

/** 지금 주소의 값(embed 포함)을 지키며 몇 개만 바꾼 목록 주소 — 값을 바꾸면 쪽은 처음으로. */
export function listHref(sp: Record<string, string | undefined>, patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v !== undefined && k !== "page") params.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const s = params.toString();
  return s ? `${LIST_PATH}?${s}` : LIST_PATH;
}
