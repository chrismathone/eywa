import "server-only";
import { kstShortStamp } from "@/lib/date-kst";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import { maskPhone } from "@/features/attendance/kiosk/message";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { StudentDetail } from "@/features/students/server/queries";
import { studentStatusMeta } from "@/features/students/status/status-labels";
import { DIRECTION_META, FLOW_KINDS, FLOW_UNIT, type FlowInsightView, type FlowKind } from "../flow-insight";
import { flowCardState, type FlowStanding } from "../flow-recency";
import type { CoverageState, ExploreAnalysis, ExploreAnalysisBlock, ExploreAside, ExploreCoverageItem, ExploreSector } from "../model";
import { settle, type Settled } from "./shared";

/**
 * 원생 중심의 왼쪽 열 · 오른쪽 아래 '분석·판단' 조립(원장 2026-11-05 시안 :3978과 같은 구조).
 * 숫자는 조각과 **같은 조회 결과**에서만 센다(수업보고서 total · 상담 · 메모 건수 = 각 조각이 읽은 값) — 새 조회를 만들지 않는다.
 */

/** "김○○ (모) · 010-****-2210" — 이름 · 관계 · 가린 번호 중 있는 것만. */
function guardianLine(name: string | null, relation: string | null, phone: string | null): string | null {
  const who = [name?.trim() || null, relation?.trim() ? `(${relation.trim()})` : null].filter(Boolean).join(" ");
  const tel = phone ? maskPhone(phone) : "";
  const line = [who || null, tel || null].filter(Boolean).join(" · ");
  return line || null;
}

export function buildStudentAside(input: {
  student: StudentDetail;
  today: string;
  base: string;
  reportsTotal: Settled<number>;
  consultCount: Settled<number>;
  memoCount: Settled<number>;
  contribution: boolean;
  coverage: ExploreCoverageItem[];
}): ExploreAside {
  const s = input.student;
  const parent = guardianLine(s.parentName, s.parentRelation, s.parentPhone);
  const parent2 = guardianLine(s.parent2Name, s.parent2Relation, s.parent2Phone);
  const n = (v: Settled<number>) => (v.ok ? v.value : null);
  const records = [
    { label: "수업보고서", value: n(input.reportsTotal) },
    { label: "상담", value: n(input.consultCount) },
    { label: "특이사항 메모", value: n(input.memoCount) },
  ].filter((r): r is { label: string; value: number } => r.value !== null).map((r) => ({ ...r, unit: "건" }));
  return {
    heading: "원생 정보",
    basics: {
      title: "기본 정보",
      spacer: `기준일 ${input.today}`,
      facts: [
        { label: "학교·학년", value: schoolGradeLabel(s.school, s.grade) || "—" },
        { label: "등록일", value: s.enrolledAt ?? "—" },
        ...(parent ? [{ label: "학부모", value: parent }] : []),
        ...(parent2 ? [{ label: "보호자2", value: parent2 }] : []),
        ...(s.studentCode ? [{ label: "원생번호", value: s.studentCode }] : []),
      ],
      link: { href: input.base, label: "원생 상세 열기" },
    },
    records,
    contribution: input.contribution,
    coverage: input.coverage,
  };
}

/** 조각 상태 → 연결 상태(조각을 못 읽었으면 실패 · 권한 밖이면 열람 제한). */
export function coverageOfSector(s: ExploreSector | undefined): CoverageState {
  if (!s) return "pending";
  if (s.state === "error") return "failed";
  if (s.state === "denied") return "restricted";
  return "connected";
}

/**
 * 이 화면이 아직 내용을 싣지 않는 원천(클래스노트 · 셔틀 · 오늘 수학)의 연결 여부 — 연결 사실만 확인하고 내용은 원래 화면에서 본다.
 * 연결이 있으면 '일부 확인'(연결은 확인 · 내용은 원래 화면) · 클래스노트 연결이 없으면 '연결 전'.
 * 🔴 기능이 꺼진 지점은 줄째 뺀다(있었는지조차 모르게) · 셔틀 탑승 등록이 0건이면 셔틀을 안 타는 원생이라 줄을 뺀다('연결 전'이 아니다).
 * 급여·계약 줄은 두지 않는다 — 원생의 기록이 아니고, 열람할 수 있는 원장에게 '열람 제한'이라 적으면 사실이 아니다.
 */
export async function loadCoverageExtras(tenantId: string, studentId: string): Promise<ExploreCoverageItem[]> {
  const db = await createClient();
  const disabled = (await getTenantSettings()).modules.disabled;
  const useClassnote = isModuleEnabled(disabled, "classnote");
  const useShuttle = isModuleEnabled(disabled, "shuttle");
  const count = (scope: string, table: "classnote_student_links" | "shuttle_riders") =>
    settle(scope, db.from(table).select("student_id", { count: "exact", head: true }).eq("student_id", studentId).then(({ count: n, error }) => {
      if (error) throw error;
      return n ?? 0;
    }));
  const [classnote, shuttle, todaysMath] = await Promise.all([
    useClassnote ? count("explore.coverage.classnote", "classnote_student_links") : Promise.resolve(null),
    useShuttle ? count("explore.coverage.shuttle", "shuttle_riders") : Promise.resolve(null),
    isFeatureOptedIn(tenantId, "todays_math").catch(() => false),
  ]);
  const items: ExploreCoverageItem[] = [];
  if (classnote) items.push({ key: "classnote", label: "학부모 글(클래스노트)", state: !classnote.ok ? "failed" : classnote.value > 0 ? "partial" : "pending" });
  if (shuttle && (!shuttle.ok || shuttle.value > 0)) items.push({ key: "shuttle", label: "셔틀", state: shuttle.ok ? "partial" : "failed" });
  if (todaysMath) items.push({ key: "todays-math", label: "오늘 수학 진도", state: "pending" });
  return items;
}

/** 흐름 분석 종류별로 이어진 조각(고른 요소 따라가기) — 상담 흐름 = 상담 · 타임라인 흐름 = 수강(과목)·특이사항·성적·타임라인(그 분석이 읽는 기록). */
const FLOW_RELATED: Record<FlowKind, string[]> = {
  consultations: ["consultations"],
  timeline: ["timeline", "memos", "grades", "subject:*", "classes"],
};
const FLOW_TITLE: Record<FlowKind, string> = { consultations: "상담", timeline: "타임라인" };

/**
 * `standing`·`today` = 보는 날의 원생 상태(재원·휴원·퇴원)와 KST 오늘 — 저장된 분석이 오래됐어도 배지·안내는 보는 날 기준으로 바로잡는다
 * (원장 2026-11-06 — 4월 상담만 보고 11월에 '좋아지는 중'). 판정은 `flowCardState` 한 곳. 퇴원·휴원 배지 = 원생 상태 배지(`studentStatusMeta`) 그대로.
 * `actualAts` = 화면이 같은 표에서 읽은 실제 기록 시각(상담 흐름 = 상담 조각 · 못 읽었거나 같은 표가 아니면 없음) — '아직 반영 전' 안내.
 */
export function buildStudentAnalysis(flow: {
  allowed: boolean;
  canRefresh: boolean;
  rows: Settled<Partial<Record<FlowKind, FlowInsightView>>> | null;
  standing: FlowStanding;
  today: string;
  actualAts?: Partial<Record<FlowKind, readonly string[] | null>>;
}): ExploreAnalysis {
  if (!flow.allowed) return { state: "denied", blocks: [], canRefresh: false, note: "원생상담 열람 권한(전체)이 있어야 흐름 분석을 볼 수 있습니다." };
  if (!flow.rows || !flow.rows.ok) return { state: "error", blocks: [], canRefresh: false, note: "흐름 분석을 조회하지 못했습니다. 잠시 뒤 다시 열어 주세요." };
  const views = flow.rows.value;
  const blocks: ExploreAnalysisBlock[] = FLOW_KINDS.map((kind) => {
    const v = views[kind];
    const i = v?.insight ?? null;
    const card = i
      ? flowCardState({ unit: FLOW_UNIT[kind], direction: i.direction, coveredThrough: v?.coveredThrough ?? null, standing: flow.standing, today: flow.today, actualAts: flow.actualAts?.[kind] ?? null })
      : null;
    const status = card?.badge === "status" ? studentStatusMeta(flow.standing.status) : null;
    const dir = !i ? null : status ? { label: status.label, color: status.color } : DIRECTION_META[card?.badge === "unknown" ? "unknown" : i.direction];
    const stamp = v?.generatedAt ? kstShortStamp(v.generatedAt) : null;
    return {
      id: `flow:${kind}`,
      kind: "ai",
      title: FLOW_TITLE[kind],
      flowKind: kind,
      badge: dir ? { label: dir.label, color: dir.color } : null,
      notice: card?.notice ?? null,
      headline: i?.headline ?? null,
      change: i?.recentChange ? i.recentChange : null,
      watch: i?.watch ?? [],
      next: i?.nextSteps ?? [],
      basis: i ? [v?.coveredCount ? `${FLOW_UNIT[kind]} ${v.coveredCount}건 반영` : null, stamp, v?.modelLabel ?? null].filter(Boolean).join(" · ") || null : null,
      empty: i ? null : kind === "consultations" ? "아직 분석이 없습니다 · 다음 상담을 저장하면 처음 분석하고, 그 뒤로는 새 상담을 합산합니다." : "아직 분석이 없습니다 · 밤마다 새 기록이 있는 원생부터 차례로 분석합니다.",
      related: FLOW_RELATED[kind],
    };
  });
  return { state: "ready", blocks, canRefresh: flow.canRefresh };
}
