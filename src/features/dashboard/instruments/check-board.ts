/**
 * '확인할 일' — 카드에 흩어진 신호를 한 표로 모은다. 새로 판정하지 않는다: 줄마다 그 카드가 이미 받은 값을 읽고,
 * 눌렀을 때 그 카드의 상세가 열린다(같은 값이 두 벌이 되지 않게). 0건인 줄은 세우지 않는다. 순수 함수(Vitest).
 */
import { TASK_KINDS } from "@/features/staff-tasks/kinds";
import { absenceBasis } from "./absence-tree";
import { consultGaps } from "./consult";
import { classSubject, rosterOf } from "./details-shared";
import type { DetailContext } from "./details-types";
import { moneyText, num } from "./labels";

export type CheckRow = {
  key: string; area: string; title: string; target: string; basis: string; owner: string;
  /** 누르면 열리는 상세. */
  detail?: string;
  /** 그 화면으로 가는 줄. */
  href?: string;
  /** 업무 처리 현황을 여는 줄. */
  tasks?: boolean;
};

export function checkRows(ctx: DetailContext): CheckRow[] {
  const { snapshot, extras, amounts } = ctx;
  const v = snapshot.sections;
  const out: CheckRow[] = [];

  const absences = v.absences?.data?.rows;
  if (absences?.length) {
    const basis = absenceBasis(extras.absenceLines);
    out.push({
      key: "absence", area: "출결", title: "반복 결석 학생 (14일 · 3회 이상)", target: `${num(absences.length)}명`,
      basis: basis ? `사전 통보 제외 ${num(basis.plain)}회 · 반 ${num(basis.classes)} · 담임 ${num(basis.teachers)}` : `사전 통보 제외 ${num(absences.reduce((n, r) => n + r.unexplained, 0))}회`,
      owner: basis ? `담임 ${num(basis.teachers)}명` : "담임", detail: "repeatAbsence",
    });
  }

  const bill = v.billing?.data?.at(-2);
  const open = bill ? bill.unpaidCount + bill.partialCount : 0;
  if (bill && open > 0) {
    out.push({
      key: "billing", area: "수납", title: `${Number(bill.period.slice(5))}월 미납 · 부분납`, target: `${num(open)}건`,
      basis: amounts ? `남은 금액 ${moneyText(bill.outstanding)}` : `미납 ${num(bill.unpaidCount)} · 부분납 ${num(bill.partialCount)}`,
      owner: "수납 담당", detail: "billing6",
    });
  }

  const homework = v.homework?.data;
  if (homework?.students) {
    const students = extras.report?.students;
    // 그 숙제가 나온 과목의 담임만 — 다른 과목 담임까지 세면 사람 수가 부푼다.
    const teachers = new Set((students ?? []).flatMap((s) => s.classes.flatMap((c) => rosterOf(ctx, s.id, classSubject(ctx, c.subject, c.classId)).teacher.split("·"))).filter((t) => t !== "—")).size;
    out.push({
      key: "homework", area: "숙제", title: `숙제 수행률 60% 미만 (최근 ${num(homework.windowDays)}일)`, target: `${num(homework.students)}명`,
      basis: `미제출 ${num(homework.notSubmitted)} · 수행률 0% ${num(homework.zero)}`, owner: teachers ? `담임 ${num(teachers)}명` : "담임", detail: "reports",
    });
  }

  const gaps = extras.consult ? consultGaps(extras.consult) : null;
  if (gaps?.twice) {
    out.push({
      key: "homeroom", area: "상담", title: "지난달부터 담임 상담 없는 학생", target: `${num(gaps.twice)}명`,
      basis: `이번 달 담임 상담 ${gaps.rate === null ? "—" : `${gaps.rate}%`}`, owner: `담임 ${num(gaps.teachers)}명`, detail: "studentConsult",
    });
  }

  const followups = v.consultations?.data?.overdueFollowUps;
  if (followups) out.push({ key: "followup", area: "상담", title: "상담 후속조치 기한 지남", target: `${num(followups)}건`, basis: "원생상담 후속조치", owner: "상담자별", detail: "studentConsult" });

  const stalled = v.consultProgress?.data?.summary.stalled;
  if (stalled?.length) {
    out.push({
      key: "stalled", area: "신규", title: "멈춘 신규 콜&상담", target: `${num(stalled.length)}건`,
      basis: `가장 오래된 건 ${num(Math.max(...stalled.map((s) => s.days)))}일째`, owner: "상담자별", detail: "consultProgress",
    });
  }

  const approval = v.operations?.data?.find((o) => o.href === "/approvals");
  if (approval?.count) out.push({ key: "approval", area: "결재", title: "전자결재 내 차례", target: `${num(approval.count)}${approval.unit}`, basis: "내가 결재할 문서", owner: "나", href: approval.href });

  const late = (extras.taskBoard?.kinds ?? []).filter((k) => k.late > 0).map((k) => ({ kind: k.kind, count: k.late }));
  if (late.length) {
    const count = late.reduce((n, t) => n + t.count, 0);
    out.push({
      key: "tasks", area: "할 일", title: "기한 지난 할 일", target: `${num(count)}건`,
      basis: late.slice(0, 3).map((t) => `${TASK_KINDS[t.kind]?.label ?? "기타"} ${num(t.count)}`).join(" · "), owner: "담당자별", tasks: true,
    });
  }
  return out;
}
