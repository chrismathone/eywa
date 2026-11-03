/**
 * 카드 **요약형**(½×1 위젯)과 편집기 얼굴의 한 줄 숫자 — 순수 함수. 카드 본문이 쓰는 값을 그대로 다시 센다(같은 질문에 다른 답 금지).
 * 값이 아직 없으면(권한 없음·조회 실패·시간 초과) null — 화면은 '—'로 적고 0으로 바꾸지 않는다.
 * 🔴 금액은 스냅샷에 실린 값만 읽는다 — 가린 역할의 스냅샷은 서버가 이미 0으로 비웠으므로(`shape.ts`) 여기서 금액을 그리지 않는다(`amounts`).
 */
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { levelTestListIn, upcomingAdmissionsRows } from "@/features/dashboard/overview/display";
import { previousDayRange } from "@/features/dashboard/overview/previous-day";
import { splitEnrolledRecent } from "@/features/dashboard/overview/enrolled-recent";
import { earlyCounts } from "@/features/withdrawals/early-exit";
import { cardDef } from "./registry";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";

export type Summary = { value: string; unit?: string; detail?: string; danger?: boolean };

const n = (v: number) => v.toLocaleString("ko-KR");
const man = (v: number) => `${n(Math.round(v / 10_000))}만원`;
const top = (rows: readonly { label: string; value: number }[], labels: Record<string, string>, k = 3) =>
  [...rows].sort((a, b) => b.value - a.value).slice(0, k).map((r) => `${labels[r.label] ?? r.label} ${n(r.value)}`).join(" · ");

/** id = `kpi:<칸>` · `panel:<카드>`. `amounts` = 이 카드가 금액을 그려도 되는가(이번 달 수납 카드). */
export function summaryOf(id: string, snap: OverviewSnapshot, opts: { amounts?: boolean } = {}): Summary | null {
  const v = snap.sections;
  const def = cardDef(id);
  if (!def) return null;
  switch (def.key) {
    case "students":
      return v.students?.data ? { value: n(v.students.data.enrolled), unit: "명", detail: "현재 재원" } : null;
    case "courses":
      return v.courses?.data ? { value: n(v.courses.data.total), unit: "개", detail: "지금 듣는 반" } : null;
    case "withdrawals":
      return v.withdrawals?.data ? { value: n(v.withdrawals.data.rows.length), unit: "명", detail: `${Number(v.withdrawals.data.month.slice(5))}월 퇴원·수업종료 · ${EXIT_BASIS_TAG}` } : null;
    case "intake":
      return v.intake?.data ? { value: n(v.intake.data.length), unit: "건", detail: "오늘 접수" } : null;
    case "calendar":
      return v.calendar?.data ? { value: n(levelTestListIn(v.calendar.data, previousDayRange(snap.today)).active.length), unit: "건", detail: "전일 레벨테스트" } : null;
    case "enrolledToday": {
      // 전일 / 이달 신규(원장 2026-10-21) — 카드와 같은 가르기. 요약형은 숫자 한 칸이라 이번 달을 숫자로, 어제는 보조 줄로.
      if (!v.enrolledToday?.data) return null;
      const recent = splitEnrolledRecent(v.enrolledToday.data, snap.today);
      return { value: n(recent.month.length), unit: "명", detail: `이달 신규 · 전일 ${n(recent.yesterday.length)}명` };
    }
    case "firstClass":
      return v.firstClass?.data ? { value: n(v.firstClass.data.length), unit: "명", detail: "오늘 첫 수업" } : null;
    case "absent":
      return v.absent?.data ? { value: n(v.absent.data.students.length), unit: "명", detail: "최근 7일 결석", danger: v.absent.data.students.length > 0 } : null;
    case "makeup":
      return v.makeup?.data ? { value: n(v.makeup.data.rows.length), unit: "건", detail: "한 달 보강 예정" } : null;
    case "studentsComp": {
      const d = v.students?.data;
      if (!d) return null;
      const levels = d.levelSplit?.rows.filter((r) => r.total > 0).slice(0, 3).map((r) => `${r.label} ${n(r.total)}`).join(" · ");
      return { value: n(d.academy?.enrolled ?? d.enrolled), unit: "명", detail: levels || "현재 재원생 구성" };
    }
    case "attendance": {
      const a = v.attendance?.data;
      if (v.attendance?.at == null) return null;
      if (!a || a.total === 0) return { value: "—", detail: "오늘 출결 기록 없음" };
      return { value: n(Math.round(((a.present + a.late) / a.total) * 100)), unit: "%", detail: `오늘 출석 · 결석 ${n(a.absent)}`, danger: a.absent > 0 };
    }
    case "billingMonth": {
      const b = v.billing?.data?.at(-1);
      if (!b) return null;
      const due = b.unpaidCount + b.partialCount;
      return { value: `${n(b.paidCount)}/${n(b.totalCount)}`, unit: "건", detail: opts.amounts ? `미수 잔액 ${man(b.outstanding)}` : `미납·부분납 ${n(due)}건`, danger: due > 0 };
    }
    case "billing6": {
      const b = v.billing?.data?.at(-1);
      return b ? { value: man(b.totalBilled - b.totalDiscount), detail: "이번 달 실청구" } : null;
    }
    case "newcomerStages":
    case "newcomerChecks": {
      const c = v.newcomers?.data;
      if (!c) return null;
      const overdue = c.items.filter((r) => !r.optional).reduce((s, r) => s + r.overdue, 0);
      return { value: n(c.total), unit: "명", detail: `등록 90일 · 기한 경과 ${n(overdue)}건`, danger: overdue > 0 };
    }
    case "earlyExits": {
      const e = v.earlyExits?.data;
      if (!e) return null;
      const c = earlyCounts(e.rows);
      return { value: n(c["3m"]), unit: "명", detail: `이번 달 · 1개월 ${n(c["1m"])} · 2개월 ${n(c["2m"])}`, danger: c["3m"] > 0 };
    }
    case "changes": {
      const m = v.changes?.data?.at(-1);
      if (!m) return null;
      const d = m.enrolled - m.withdrawn;
      return { value: `${d > 0 ? "+" : ""}${n(d)}`, unit: "명", detail: `이번 달 등록 ${n(m.enrolled)} · 퇴원 ${n(m.withdrawn)}`, danger: d < 0 };
    }
    case "enrolledTrend": {
      const t = v.enrolledTrend?.data;
      return t ? { value: n(t.monthly.at(-1)?.count ?? 0), unit: "명", detail: "오늘 재원생" } : null;
    }
    case "courseTrend": {
      const t = v.courseTrend?.data;
      return t ? { value: n(t.monthly.at(-1)?.count ?? 0), unit: "개", detail: "오늘 강좌수" } : null;
    }
    case "subjects":
      return v.students?.data ? { value: n(v.students.data.concurrent), unit: "명", detail: top(v.students.data.subjects, snap.subjects) || "과목별 수강" } : null;
    case "grades":
      return v.students?.data ? { value: n(v.students.data.academy?.enrolled ?? v.students.data.enrolled), unit: "명", detail: "학년별 재원생" } : null;
    case "schools":
      return v.students?.data ? { value: n(v.students.data.schools.length), unit: "곳", detail: top(v.students.data.schools, {}, 2) } : null;
    case "admissions": {
      const s = v.admissions?.data;
      return s ? { value: n(s.total), unit: "건", detail: `등록 ${n(s.enrolled)}${s.rate === null ? "" : ` · 전환 ${Math.round(s.rate)}%`}` } : null;
    }
    case "repeatAbsence": {
      const r = v.absences?.data;
      return r ? { value: n(r.rows.length), unit: "명", detail: r.rows.slice(0, 3).map((x) => x.studentName).join(" · ") || "해당 학생 없음", danger: r.rows.length > 0 } : null;
    }
    case "attendance14": {
      const last = v.attendanceTrend?.data?.filter((p) => p.rate !== null).at(-1);
      if (!v.attendanceTrend?.data) return null;
      return { value: last?.rate == null ? "—" : n(Math.round(last.rate)), unit: last?.rate == null ? undefined : "%", detail: "최근 등원율" };
    }
    case "consultProgress": {
      const c = v.consultProgress?.data?.summary;
      return c ? { value: n(c.counts.received), unit: "건", detail: `최근 30일 · 멈춘 상담 ${n(c.stalled.length)}`, danger: c.stalled.length > 0 } : null;
    }
    case "reports": {
      const h = v.homework?.data;
      const u = v.unread?.data;
      if (!h && !u) return null;
      return { value: h ? n(h.students) : "—", unit: h ? "명" : undefined, detail: [h ? "숙제 60% 미만" : null, u ? `미확인 ${n(u.reports)}건` : null].filter(Boolean).join(" · "), danger: (h?.students ?? 0) > 0 };
    }
    case "studentConsult": {
      const c = v.consultations?.data;
      return c ? { value: n(c.lastWeek), unit: "건", detail: `최근 7일 · 기한 경과 ${n(c.overdueFollowUps)}`, danger: c.overdueFollowUps > 0 } : null;
    }
    case "sheets": {
      const rows: { l: string; d: { filled: number; total: number } }[] = [];
      if (v.englishSheet?.data) rows.push({ l: "영어", d: v.englishSheet.data });
      if (v.mathSheet?.data) rows.push({ l: "수학", d: v.mathSheet.data });
      if (!rows.length) return null;
      const pct = (d: { filled: number; total: number }) => (d.total > 0 ? `${Math.round((d.filled / d.total) * 100)}%` : "—");
      return { value: pct(rows[0]!.d), detail: rows.map((r) => `${r.l} ${pct(r.d)}`).join(" · ") };
    }
    case "nowClasses": {
      const s = v.schedule?.data;
      return s ? { value: n(s.filter((x) => x.status === "ongoing").length), unit: "개", detail: `진행 중 · 오늘 ${n(s.length)}개` } : null;
    }
    case "admissionsSchedule": {
      // 오늘부터(일정 배열엔 '전일 입테'용 어제 레벨테스트도 실린다).
      const list = v.calendar?.data ? upcomingAdmissionsRows(v.calendar.data, snap.today) : null;
      if (!list) return null;
      // 숫자 = 살아 있는 일정만(취소는 kind가 null — 카드 열 머리와 같은 축).
      const live = list.filter((e) => e.kind !== null);
      const tests = live.filter((e) => e.kind === "levelTest").length;
      return { value: n(live.length), unit: "건", detail: `한 달 · 입테 ${n(tests)} · 첫수업 ${n(live.length - tests)}` };
    }
    case "staff": {
      const s = v.staff?.data;
      return s ? { value: n(s.reduce((sum, r) => sum + r.value, 0)), unit: "명", detail: s.slice(0, 2).map((r) => `${r.label} ${n(r.value)}`).join(" · ") } : null;
    }
    case "operations": {
      const o = v.operations?.data;
      return o ? { value: n(o.length), unit: "항목", detail: o.slice(0, 2).map((x) => `${x.label} ${x.count ?? "—"}`).join(" · ") || "열람 가능한 업무 없음" } : null;
    }
    case "expenses": {
      const e = v.expenses?.data;
      return e ? { value: n(e.count), unit: "건", detail: "이번 달 지출결의" } : null;
    }
    case "notices": {
      const list = v.notices?.data;
      return list ? { value: n(list.length), unit: "건", detail: list[0]?.title ?? "등록된 공지 없음" } : null;
    }
  }
  return null;
}

/** 데이터가 0건인 카드(얇게 그린다 — 줄 높이를 늘리지 않는다). 모르면 false. */
export function isEmptyCard(id: string, snap: OverviewSnapshot): boolean {
  const v = snap.sections;
  switch (id) {
    case "panel:notices":
      return v.notices?.data?.length === 0;
    case "panel:operations":
      return v.operations?.data?.length === 0;
    case "panel:admissionsSchedule":
      return v.calendar?.data ? upcomingAdmissionsRows(v.calendar.data, snap.today).length === 0 : false;
    case "panel:nowClasses":
      return v.schedule?.data?.length === 0;
    case "panel:repeatAbsence":
      return v.absences?.data?.rows.length === 0;
    case "panel:expenses":
      return v.expenses?.data?.count === 0;
    default:
      return false;
  }
}
