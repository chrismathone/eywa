/**
 * 상담 진행 상세 — 단계는 막대 하나로, 멈춘 상담은 멈춘 단계마다 표 한 장(원장 2026-11-02 *"깔끔하게 정리되면 좋겠음"* —
 * 수치 칸 일곱 개가 두 줄로 접히고 '상태' 한 칸에 단계와 날수가 섞여 읽기 어려웠다).
 * 값은 운영실 카드와 같다(`summarizeProgress` — 단계 수 = 최근 30일 상담 · 멈춘 상담 = 최근 60일 상담 중 결정이 없는 것). 순수 함수(Vitest).
 */
import { PROGRESS_WINDOW_DAYS, STALL_CONSULTED_DAYS, STALL_LEVEL_TEST_DAYS, STALL_WINDOW_DAYS, type ConsultProgressData, type StalledConsult } from "@/features/dashboard/overview/consultation-progress";
import { consultProgressStatsHref } from "@/features/dashboard/overview/kpi-links";
import { consultSteps } from "./derive";
import { consultGroupsOf, oneSeries } from "./details-shared";
import type { Detail, DetailContext, DetailSlice, DetailTable } from "./details-types";
import { monthDay, num } from "./labels";

const STAGES = [
  { reason: "consulted", title: "상담 뒤 결정 없음", col: "상담 뒤", note: `상담을 마치고 ${STALL_CONSULTED_DAYS}일이 넘도록 등록 · 미등록 결정이 없는 상담입니다.` },
  { reason: "levelTest", title: "입테 뒤 등록 없음", col: "입테 뒤", note: `입테를 치르고 ${STALL_LEVEL_TEST_DAYS}일이 넘도록 등록이 없는 상담입니다(다음 입테가 잡힌 건은 뺍니다).` },
] as const;

export function consultProgressDetail(data: ConsultProgressData, ctx: DetailContext): Detail {
  const { summary } = data;
  const steps = consultSteps(summary.counts);
  // 과목 묶음 = 신규 콜&상담 통계 · 관리현황과 같은 판정(`consultGroupsOf`) — 못 읽는 글자는 묶음 없이 원문만 칸에 적는다.
  const groupsOf = consultGroupsOf(ctx);
  const rows = summary.stalled.map((r) => ({ r, subject: groupsOf(r.subject) }));
  const tablesOf = (list: readonly { r: StalledConsult; subject: string[] }[]): DetailTable[] => STAGES.flatMap((s) => {
    const mine = list.filter((x) => x.r.reason === s.reason);
    return mine.length ? [{
      title: s.title, unit: "건", cols: ["이름", "과목", s.col], note: s.note,
      rows: mine.map(({ r, subject }) => ({ cells: [r.name, subject.join("·") || r.subject?.trim() || "—", `${num(r.days)}일`], href: `/enrollment/${r.id}`, linkTitle: `${r.name} 신규 콜&상담`, subject })),
    }] : [];
  });
  const statsOf = (list: readonly { r: StalledConsult }[]): [string, string][] => [
    ["멈춘 상담", `${num(list.length)}건`], ...STAGES.map((s): [string, string] => [s.title, `${num(list.filter((x) => x.r.reason === s.reason).length)}건`]),
  ];
  // 과목 탭 — 멈춘 상담만 과목으로 가를 수 있다(단계 수는 학원 전체 값이라 탭에선 숨긴다).
  const tabs = [...new Set(rows.flatMap((x) => x.subject))];
  const bySubject = Object.fromEntries(tabs.map((tab): [string, DetailSlice] => {
    const mine = rows.filter((x) => x.subject.includes(tab));
    return [tab, { stats: statsOf(mine), tables: tablesOf(mine) }];
  }));
  return {
    title: "상담 진행",
    period: `단계 = 최근 ${PROGRESS_WINDOW_DAYS}일 상담(${monthDay(summary.from)}부터) · 멈춘 상담 = 최근 ${STALL_WINDOW_DAYS}일`,
    stats: [["접수", `${num(summary.counts.received)}건`], ["등록", `${num(summary.counts.enrolled)}건`], ["수업 시작", `${num(summary.counts.started)}건`], ["멈춘 상담", `${num(summary.stalled.length)}건`]],
    trend: { title: "단계별 — 접수에서 수업 시작까지", labels: steps.map(([k]) => k), series: [oneSeries("건수", steps.map(([, n]) => n))], unit: "건", kind: "bar", noRange: true },
    tables: tablesOf(rows),
    bySubject,
    link: { href: ctx.snapshot.teacherView || ctx.snapshot.view?.subjectScoped ? "/enrollment" : consultProgressStatsHref(), label: "신규 콜&상담 열기" },
  };
}
