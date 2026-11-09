import { inRange, resolveRange, type RangeKey, type RangeWindow } from "@/features/withdrawals/exit-rows";
import { monthRange } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { ArchiveRow } from "./archive-model";
import { formViewHref } from "@/features/documents/categories";
import { archiveReason, webReportReason, type ListReason } from "./list-reason";
import { REPORT_STATUS, canCancelReport, directorIds, hasJobTitle, isDirectReport, isParticipant, managerIds, managerStepSkipped, refundWaiting, reportStatusChips, titledName, type RefundStep, type ReportListRow, type ReportStatus, type StaffOption } from "./model";
import { decisionBlocksProcessing } from "./refund-decision";
import { refundApprovalLines, refundApprovalNames, type RefundOutcome } from "./approval-lines";

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
  /**
   * 상태 글 — 웹 보고서는 `reportStatusLabel`과 같은 글(검색에 든다) · 기존 기록은 '스프레드시트 기록'(상태 칸에 그대로).
   * 웹 보고서의 상태 칸은 이 글이 아니라 3단계 막대(`reportProgress`)로 그린다(원장 2026-11-06 시안 A).
   */
  statusLabel: string;
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
  /** 내 차례가 원장 환불 결정이다(원장 2026-11-06 · 결정할 줄을 보이는 보고서 줄에만 · 원장급·쓰기 권한) — 상태 칸 꼬리 '내 환불 결정 필요'(보고서 상세로). '내 승인 필요' 필터에 든다. */
  refundTurn?: boolean;
  /** 진행 막대 재료 — 웹 보고서만(기존 기록은 없음 = 막대 없이 '스프레드시트 기록'). 판정은 `reportProgress`. */
  flow?: ReportFlow | null;
  /**
   * 환불 단계 — `decision` 환불 결정 대기 · `desk` 데스크 환불 대기(지금은 `refundWaiting`과 같은 판정) · `both` 둘 다(결정 뒤 새 줄이 생겨 다시 결정 대기인데
   * 앞 요청서의 데스크 환불도 남음 — 리뷰 r2 m5) · 없으면 null. 진행 막대 아래 한 줄에 '환불 결정 대기'·'데스크 환불 대기'(둘 다면 둘 다)로 선다.
   */
  refundStage?: "decision" | "desk" | "both" | null;
  /** 요청 취소 기록 — 사유(이전 취소는 null)·취소한 사람·시각(ISO). 있으면 '요청 취소 · 취소일'에 마우스를 올려 본다. */
  cancel?: { reason: string | null; by: string; at: string } | null;
  /**
   * 데스크 환불을 처리하는 화면 주소 — '내 환불 처리 필요' 링크가 새 창(수납 메뉴)으로 간다(없으면 보고서 상세).
   * 데스크 차례일 때만 = 내 몫·완료 전 환불 요청서 중 가장 먼저 만든 것(`/billing/refunds/{id}` — `formViewHref`).
   */
  deskHref?: string | null;
  search: string;
};

/** 진행 막대 재료(웹 보고서 한 건) — `buildListItems`가 채우고 `reportProgress`가 읽는다. */
export type ReportFlow = {
  status: ReportStatus;
  /**
   * 같은 묶음에 아직 승인 전(작성 요청·반려·관리자 요청·원장 승인 대기)인 다른 과목 보고서가 있나 — 승인 완료(approved) 줄의 단계를 가른다.
   * DB의 approved는 '다른 과목 대기'와 '전부 승인 · 환불(또는 처리)만 대기'를 둘 다 뜻해 환불 유무로는 못 가른다(리뷰 2026-11-06).
   */
  othersPending: boolean;
  /**
   * 형제 조회가 실패해(`groupStatuses` 없음) 다른 과목 보고서가 다 승인됐는지 **모른다**(승인 완료 줄 · 보이는 형제엔 승인 전이 없음 — 리뷰 r2 (a)).
   * 막대는 2단계로 두고(3단계로 앞지르지 않는다) 아래 한 줄은 '다른 과목 승인 확인 못 함'(사실 그대로 — '다른 과목 승인 대기'라고 단정하지 않는다).
   * 환불 대기 유무로 형제 상태를 추측하지 않는다(데스크 대기를 '다 승인됨'으로 읽으면 앞질러 보였다).
   */
  othersUnknown?: boolean;
  /** 마지막 수업일 — 처리 예약이면 그날 처리한다(DB 'apply' · `effective_date <= today`). */
  effectiveDate: string;
  /** 처리 시각(처리 완료일) · 마지막 변경 시각(취소 기록이 없는 취소의 취소일 — DB 'cancel'이 `updated_at`을 새로 적는다). */
  appliedAt: string | null;
  updatedAt: string;
  /** 이 사람이 요청을 취소할 수 있나(`canCancelReport` — 요청자 · 원장급) — 재검토 건의 '내 재요청 필요'. */
  canCancel: boolean;
};

/** 진행 막대 세 단계(원장 2026-11-06 시안 A). */
export const PROGRESS_STEPS = ["강사 작성", "관리자 승인", "처리 완료"] as const;
/** 막대 한 칸 — 끝남 · 지금(빗금) · 지금인데 반려·재검토(빨강) · 아직 · 요청 취소(옅은 회색). */
export type ProgressCell = "done" | "now" | "alert" | "todo" | "off";
/** 막대 아래 단계 이름 — 처리 완료면 칸은 셋 다 'done'이고 이름은 '처리 완료'만 'now'(굵게)다. */
export type ProgressName = ProgressCell;
export type ProgressNote = {
  text: string;
  tone: "plain" | "alert" | "done";
  /** 요청 취소 말풍선(취소 기록이 있을 때만) — 제목 '취소 사유' · 사유 · '취소한 사람 · MM-DD HH:mm'(KST). */
  cancel?: { reason: string; meta: string };
};
/**
 * 꼬리 — 내 할 일은 링크(`href`) · 할 일 없는 열람은 '승인 대상 아님'(링크 아님).
 * `newWindow` = 다른 메뉴(수납의 환불 요청서)라 새 창으로 연다 — 보고서 상세로 가는 꼬리는 같은 창.
 */
export type ProgressTail =
  | { text: "내 승인 필요" | "내 환불 결정 필요" | "내 작성 대기" | "내 환불 처리 필요" | "내 재요청 필요"; href: string; newWindow?: boolean }
  | { text: "승인 대상 아님"; href: null };
export type ReportProgress = {
  /** 지금 단계(1~3) · 처리 완료 3 · 요청 취소 0. */
  step: 0 | 1 | 2 | 3;
  cells: ProgressCell[];
  names: { text: string; state: ProgressName }[];
  /** 막대로 알 수 없는 것만(평상시 '작성 요청'·'관리자 요청'은 막대와 겹쳐 쓰지 않는다). */
  notes: ProgressNote[];
  tail: ProgressTail | null;
  /** 막대(`role="img"`)의 이름 — 예: '진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기'. */
  label: string;
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
  /** 원장급(`cancelsAsDirector`) — 남이 요청한 보고서도 취소한다(재검토 건의 '내 재요청 필요'). 기본 false. */
  directorLevel?: boolean;
  /**
   * 묶음 id → 그 묶음 보고서 전부의 상태(`listReports` — 형제가 열람 범위 밖이라 목록에 없어도 읽는다).
   * 없는 묶음은 이 목록에 보이는 형제로만 본다. 통째로 없으면(조회 실패) 승인 완료 줄은 '다른 과목 승인 확인 못 함'(2단계 · 다른 과목 대기라고 단정하지 않는다 —
   * 리뷰 r2 (a) · 보이는 형제가 승인 전이면 그것은 확인된 사실이라 '다른 과목 승인 대기').
   */
  groupStatuses?: ReadonlyMap<string, readonly { id: string; status: ReportStatus }[]>;
  /** 원장 환불 결정 대기(원장 2026-11-06 · DB `refund_hold`) — 묶음 id → 결정할 줄을 보이는 보고서(`loadRefundHolds`). 없으면 대기 없음. */
  holds?: ReadonlyMap<string, string | null>;
  /** 데스크 환불 단계·결정 대기 조회가 실패했다(리뷰 r3 R2-m10) — 승인 완료 칩을 '처리 확인 대기'라고 단정하지 않는다('환불 단계 확인 못 함'). */
  refundsFailed?: boolean;
  /** 원장 결정 요약(`loadRefundOutcomes`) — 묶음 id → 환불 승인/환불 없음 · 결정한 사람. 승인 진행의 '✓ 결정한 원장'. */
  outcomes?: ReadonlyMap<string, RefundOutcome>;
  /** 요청 취소 기록(`loadCancelNotes` · s2_0037 사유) — 보고서 id → 사유·취소한 사람·시각. 취소된 보고서만 싣는다. */
  cancels?: ReadonlyMap<string, { reason: string | null; actorId: string | null; at: string }>;
}): ListItem[] {
  const { staff, labelOf, userId } = input;
  const writable = input.writable ?? true;
  const directorLevel = input.directorLevel ?? false;
  const listedByGroup = new Map<string, { id: string; status: ReportStatus }[]>();
  for (const r of input.reports) if (r.group_id) listedByGroup.set(r.group_id, [...(listedByGroup.get(r.group_id) ?? []), r]);
  // 같은 묶음에 아직 승인 전인 다른 과목 보고서가 있나(승인 완료 줄이 막대를 앞지르지 않게 — 리뷰 2026-11-06).
  // `pending` = 승인 전 형제가 실제로 있다(조회한 묶음 상태 · 없으면 이 목록에 보이는 형제) · `unknown` = 형제 조회가 실패했고(`groupStatuses` 없음)
  // 보이는 형제엔 승인 전이 없다 — 승인 완료 줄은 모른다(2단계 · '다른 과목 승인 확인 못 함'). 환불 대기 유무로 형제 상태를 추측하지 않는다(리뷰 r2 (a) —
  // 데스크 대기를 '다 승인됨'으로, 결정 대기 없음을 '다른 과목 대기'로 읽어 1과목 보고서가 '다른 과목 승인 대기'로, 형제가 안 보이는 관리자에게 3단계로 보였다).
  const othersState = (r: ReportListRow): "pending" | "unknown" | null => {
    if (!r.group_id) return null;
    const siblings = input.groupStatuses?.get(r.group_id) ?? listedByGroup.get(r.group_id) ?? [];
    if (siblings.some((q) => q.id !== r.id && BEFORE_APPROVAL.includes(q.status))) return "pending";
    return input.groupStatuses === undefined && r.status === "approved" ? "unknown" : null;
  };
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
    const hold = !!r.group_id && !!input.holds?.has(r.group_id);
    const others = othersState(r);
    // 상태 칩 — 1과목·형제 모두 승인이면 '다른 보고서 대기'가 아니다(리뷰 r3 R2-m2 · 상세와 같은 판정).
    const chips = reportStatusChips(r, steps, hold, others ?? (input.refundsFailed ? "failed" : "done"));
    // 환불 줄(원장 2026-11-06 — 관리자 줄 다음 · 이름 직급만): 환불 결정(원장 · 결정 대기 ○ 받는 원장급 / 결정 ✓ 결정한 원장 · 환불 없음은 흐리게) → 데스크 담당마다(○ 대기 · ✓ 환불완료일자).
    const refundInput = { waiting: hold && decisionBlocksProcessing(r.status), outcome: r.group_id ? input.outcomes?.get(r.group_id) : undefined,
      directors: staff.filter((s) => s.role === "master"), personOf: staffOf, steps, canceled: r.status === "canceled" };
    const refundLines = refundApprovalLines(refundInput);
    const cancelNote = r.status === "canceled" ? input.cancels?.get(r.id) : undefined;
    const deskTurn = writable && myDeskTurn(r, steps, userId);
    // 내 몫·완료 전 환불 요청서 중 가장 먼저 만든 것(단계는 만든 순 — `loadRefundSteps`).
    const myDesk = deskTurn ? steps.find((s) => !s.completedDate && s.deskId === userId) : undefined;
    // 원장 환불 결정 차례(원장급 · 쓰기 권한) — 대기 묶음에서 결정할 줄을 보이는 보고서 줄(DB가 원장 할 일을 건 보고서 · 모르면 대표 보고서)에만.
    const holdReport = r.group_id ? input.holds?.get(r.group_id) : undefined;
    const refundTurn = writable && directorLevel && refundInput.waiting && (holdReport ? holdReport === r.id : !!r.group_leader);
    const item: ListItem = {
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
      approval: [
        ...(direct
          ? [{ text: `관리자 바로 처리 · ${titledName(staffOf(r.requested_by), FORMER_STAFF)}` }, { text: "강사 작성 없음", muted: true }]
          // 관리자 승인 생략(원장 2026-11-03 — 작성 강사가 그 과목 승인 담당) · 원장 칸은 옛 보고서에만.
          : managerStepSkipped(r)
            ? [{ text: skippedBy(r.teacher_id), muted: true }]
            : [{ text: reviewers(r, "manager") }, ...(directorIds(r).length ? [{ text: reviewers(r, "director") }] : [])]),
        ...refundLines,
      ],
      link: null,
      // 작성 차례도 쓰기 권한이 있을 때만(다른 꼬리와 같게 — 읽기 전용 보기엔 작성 버튼이 없다 · 리뷰 2026-11-06).
      myTurn: writable && ["requested", "revision"].includes(r.status) && r.teacher_id === userId,
      // 열람 표시는 진행 중에만(끝난 보고서엔 승인할 일이 없다 — 리뷰). 데스크 환불 차례도 내 차례다.
      mine: writable && (myApprovalTurn(r, userId) || deskTurn || refundTurn) ? "approve" : !isParticipant(r, userId) && !["completed", "canceled"].includes(r.status) ? "view" : "none",
      ...(deskTurn && !myApprovalTurn(r, userId) ? { deskTurn: true } : {}),
      ...(refundTurn && !deskTurn && !myApprovalTurn(r, userId) ? { refundTurn: true } : {}),
      flow: {
        status: r.status,
        othersPending: others === "pending",
        ...(others === "unknown" ? { othersUnknown: true } : {}),
        effectiveDate: r.effective_date,
        appliedAt: r.applied_at,
        updatedAt: r.updated_at,
        canCancel: canCancelReport(r, userId, writable, directorLevel),
      },
      // 환불 단계 — 원장 환불 결정 대기(DB 묶음 표시 `refund_hold` · 처리 전) · 데스크 환불 대기(`refundWaiting`) · 둘 다면 둘 다(리뷰 r2 m5 — 결정 뒤 새 줄로
      // 다시 결정 대기인데 앞 요청서의 데스크 환불도 남음 · 데스크에게 '환불 결정 대기'만 보이지 않게) · 그 밖 null.
      refundStage: refundInput.waiting ? (refundWaiting(r, steps) ? "both" : "decision") : refundWaiting(r, steps) ? "desk" : null,
      // 요청 취소 기록(s2_0037 — 사유는 1~500자 · 그 전 취소는 사유 null → 말풍선 '사유 기록 없음(이전 취소)').
      cancel: cancelNote ? { reason: cancelNote.reason, by: cancelNote.actorId ? titledOf(cancelNote.actorId) : FORMER_STAFF, at: cancelNote.at } : null,
      deskHref: myDesk ? formViewHref("refund_request", myDesk.documentId) : null,
      // 검색 = 보이는 칸 + 보고서 본문 글 전부(원장 2026-10-30 *"검색은 내용등 모든것을 검색가능하게"*) — 상담 내용·담임 의견·요청 메모·반려 사유·승인자까지.
      search: [r.snapshot.name, r.snapshot.school, r.snapshot.grade, schoolGradeLabel(r.snapshot.school, r.snapshot.grade), ...r.snapshot.courses.map((c) => c.className), teacher, reason.text, reason.note ?? "", direct ? "관리자 바로 처리" : "",
        managerStepSkipped(r) && !direct ? `관리자 승인 생략 ${skippedBy(r.teacher_id)}` : "", ...refundApprovalNames(refundInput), cancelNote?.reason ?? "", cancelNote ? (cancelNote.actorId ? titledOf(cancelNote.actorId) : FORMER_STAFF) : "",
        // 승인자·요청자는 보이는 표기 그대로(직급 포함 — '정유진 부원장'으로도 찾는다 · 리뷰 2026-11-06).
        r.exit_kind === "withdrawal" ? "퇴원" : "수강종료", ...r.subjects.map(labelOf), chips.join(" "), titledOf(r.requested_by), ...managerIds(r).map(titledOf), ...directorIds(r).map(titledOf),
        r.request_note, r.last_comment ?? "", r.body_detail ?? "", r.body_student ?? "", r.body_parent ?? "", r.body_opinion ?? "", r.body_attendance ?? "", r.body_tuition ?? "", r.body_arrears_note ?? ""].join(" "),
    };
    // 상태 칸에 보이는 글도 검색에 — 상태 이름(REPORT_STATUS) · 아래 한 줄 조각(다른 과목 승인 대기 · 데스크 환불 대기 · 처리 예약 · MM-DD ·
    // 재검토 문구 · 처리일 · 요청 취소 · 취소일 …)과 꼬리('보이는 칸은 다 검색' — 원장 2026-10-30 · 리뷰 2026-11-06).
    const p = reportProgress(item);
    return { ...item, search: [item.search, REPORT_STATUS[r.status], ...(p?.notes.map((n) => n.text) ?? []), p?.tail?.text ?? ""].join(" ") };
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

/** 형제 조회 실패 때 승인 완료 줄의 아래 한 줄(리뷰 r2 (a)) — '다른 과목 승인 대기'(형제를 실제로 확인)와 다른 말이다. 검색·막대 이름에도 이 글이 든다. */
export const OTHERS_UNKNOWN = "다른 과목 승인 확인 못 함";
/** 아직 승인 전 상태 — 같은 묶음의 이런 형제가 있으면 승인 완료 줄은 다른 과목을 기다리는 중이다. */
const BEFORE_APPROVAL: readonly ReportStatus[] = ["requested", "revision", "manager_pending", "director_pending"];
/**
 * 상태 → 지금 단계(요청 취소 0). 승인 완료(approved)는 같은 묶음에 승인 전 과목이 남았으면 2(다른 과목 승인 대기 — 환불이 걸려 있어도),
 * 다 승인됐으면 3(데스크 환불·처리만 남음) — 환불이 끝나도 단계가 되돌아가지 않는다(리뷰 2026-11-06).
 */
const STEP_OF: Record<Exclude<ReportStatus, "approved">, ReportProgress["step"]> = {
  requested: 1, revision: 1, manager_pending: 2, director_pending: 2, scheduled: 3, blocked: 3, completed: 3, canceled: 0,
};
/** 시각 → KST 'MM-DD HH:mm'. */
const kstMinute = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(5, 16).replace("T", " ");

/**
 * 상태 칸 판정 — 3단계 막대(강사 작성 · 관리자 승인 · 처리 완료)와 그 아래 한 줄(원장 2026-11-06 시안 A). 화면은 이 결과만 그린다.
 * - 칸: 끝남 · 지금(빗금) · 반려·재검토면 지금 칸이 빨강 · 아직 · 처리 완료는 셋 다 끝남 · 요청 취소는 셋 다 옅은 회색.
 *   🔑 지금 단계 뒤 칸은 늘 비운다 — 관리자 승인 생략·바로 처리도 앞질러 채우지 않는다(작성 중인 생략 보고서의 2칸이 꽉 차 보여
 *   헷갈렸다 — 리뷰 2026-11-06). 생략 보고서는 제출해 다음 단계로 넘어가면 2칸이 채워진다(이유는 승인 진행 칸의 '승인 생략' 글).
 * - 아래 한 줄 = [추가 정보, 꼬리] 중 있는 것만. 막대와 겹치는 말('작성 요청'·'관리자 요청')은 쓰지 않는다.
 * - 꼬리 = 내 할 일이면 링크(내 승인 필요 · 내 환불 결정 필요(원장급 · 보고서 상세로) · 내 환불 처리 필요 · 내 작성 대기 · 내 재요청 필요), 할 일 없는 열람이면 '승인 대상 아님'.
 *   처리 완료·요청 취소 줄엔 꼬리가 없다. 기존 기록(스프레드시트)은 막대가 없다(null).
 */
export function reportProgress(item: Pick<ListItem, "href" | "flow" | "refundStage" | "cancel" | "deskHref" | "mine" | "myTurn" | "deskTurn" | "refundTurn">): ReportProgress | null {
  const f = item.flow;
  if (!f) return null;
  const canceled = f.status === "canceled";
  const finished = f.status === "completed";
  const active = !canceled && !finished;
  // 환불 단계는 기다릴 처리가 남은 보고서에만(재검토·끝난·취소 보고서엔 없다 — `refundWaiting`과 같은 축).
  const refund = active && f.status !== "blocked" ? (item.refundStage ?? null) : null;
  // 다른 과목 대기 — 실제로 승인 전 형제가 있거나(`othersPending`) 형제 조회가 실패해 모를 때(`othersUnknown` — 3단계로 앞지르지 않는다 · 리뷰 r2 (a)).
  const waitingOthers = f.status === "approved" && (f.othersPending || !!f.othersUnknown);
  const step = f.status === "approved" ? (waitingOthers ? 2 : 3) : STEP_OF[f.status];
  const alert = f.status === "revision" || f.status === "blocked";
  const cells = PROGRESS_STEPS.map((_, i): ProgressCell => {
    const n = i + 1;
    if (canceled) return "off";
    if (finished || n < step) return "done";
    if (n === step) return alert ? "alert" : "now";
    return "todo";
  });
  const names = PROGRESS_STEPS.map((text, i) => ({ text, state: finished ? (i === 2 ? "now" : "done") : cells[i]! }));

  const notes: ProgressNote[] = [];
  if (f.status === "revision") notes.push({ text: REPORT_STATUS.revision, tone: "alert" });
  if (f.status === "director_pending") notes.push({ text: REPORT_STATUS.director_pending, tone: "plain" }); // 옛 원장 단계 — 막대는 '관리자 승인'이라 원장 차례를 글로
  if (waitingOthers) notes.push({ text: f.othersPending ? "다른 과목 승인 대기" : OTHERS_UNKNOWN, tone: "plain" });
  if (f.status === "scheduled") notes.push({ text: `처리 예약 · ${f.effectiveDate.slice(5, 10)}`, tone: "plain" });
  if (refund === "decision" || refund === "both") notes.push({ text: "환불 결정 대기", tone: "plain" });
  if (refund === "desk" || refund === "both") notes.push({ text: "데스크 환불 대기", tone: "plain" });
  if (f.status === "blocked") notes.push({ text: `${REPORT_STATUS.blocked} — 취소 후 다시 요청`, tone: "alert" });
  if (finished) notes.push({ text: `처리일 ${kstDay(f.appliedAt ?? f.updatedAt).slice(5)}`, tone: "done" });
  if (canceled) {
    const c = item.cancel;
    notes.push({
      text: `요청 취소 · 취소일 ${kstDay(c?.at ?? f.updatedAt).slice(5)}`,
      tone: "plain",
      ...(c ? { cancel: { reason: c.reason?.trim() || "사유 기록 없음(이전 취소)", meta: `${c.by} · ${kstMinute(c.at)}` } } : {}),
    });
  }

  const approveTurn = item.mine === "approve" && !item.deskTurn;
  const tail: ProgressTail | null = !active
    ? null
    : approveTurn
      // 환불 결정 차례는 결정 자리(상세 '환불 확인' 칸 `#refund`)로 바로(리뷰 r2 m8).
      ? item.refundTurn ? { text: "내 환불 결정 필요", href: `${item.href}#refund` } : { text: "내 승인 필요", href: item.href }
      : item.deskTurn
        ? item.deskHref
          ? { text: "내 환불 처리 필요", href: item.deskHref, newWindow: true }
          : { text: "내 환불 처리 필요", href: item.href }
        : item.myTurn
          ? { text: "내 작성 대기", href: item.href }
          : f.status === "blocked" && f.canCancel
            ? { text: "내 재요청 필요", href: item.href }
            : item.mine === "view"
              ? { text: "승인 대상 아님", href: null }
              : null;

  const head = canceled ? "진행 중단" : finished ? "3단계 모두 완료" : `진행 ${step}/3단계 · ${PROGRESS_STEPS[step - 1]}`;
  const said = notes.map((n) => n.text).join(" · ");
  return { step, cells, names, notes, tail, label: said ? `${head} — ${said}` : head };
}
