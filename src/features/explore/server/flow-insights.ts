import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import {
  FLOW_KIND_LABEL,
  FLOW_RECORD_CAP,
  buildFlowPrompt,
  latestAt,
  parseFlowInsight,
  splitNewRecords,
  type FlowInsight,
  type FlowInsightView,
  type FlowKind,
} from "../flow-insight";
import { flowRecency, isFutureBasis, recentCount, settleDirection, upToToday } from "../flow-recency";
import { loadConsultationRecords, loadTimelineRecords } from "./flow-records";
import { loadCurrentClasses, standingLine } from "./flow-standing";

// 밤 배치 후보(크론이 이 이름으로 부른다) — 기록 읽기와 같은 파일에.
export { timelineRefreshCandidates } from "./flow-records";

/**
 * 원생 흐름 분석 — 읽기(`readFlowInsights`)와 갱신(`refreshFlowInsight`). 표 = `student_flow_insights`(s2_0027 · service_role만).
 * 갱신은 ① 상담 저장 뒤 `after()`(consultations/server/actions.ts) ② 밤 배치(`/api/cron/student-flow-insights` · timeline · 변동 학생만)
 * ③ '다시 분석' 버튼(flow-actions.ts). 🔴 화면은 **절대** 이 갱신을 부르지 않는다(페이지 로드로 AI 호출 금지).
 * 합산 = 이전 분석 + `covered_through` 뒤의 새 기록만. 새 기록이 없으면 모델을 부르지 않는다(비용 0).
 */

type Row = {
  kind: FlowKind;
  summary: unknown;
  covered_through: string | null;
  covered_count: number;
  model: string | null;
  generated_at: string;
};

export type FlowInsightRow = {
  kind: FlowKind;
  summary: FlowInsight;
  coveredThrough: string | null;
  coveredCount: number;
  model: string | null;
  generatedAt: string;
};

/** 저장된 분석(종류별 한 벌). 표가 없으면(s2_0027 미적용) throw — 호출부가 '조회 실패'로 가른다(0건으로 꾸미지 않는다). */
export async function readFlowInsights(tenantId: string, studentId: string): Promise<Partial<Record<FlowKind, FlowInsightRow>>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("student_flow_insights")
    .select("kind, summary, covered_through, covered_count, model, generated_at")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (error) throw new Error(`흐름 분석 조회 실패: ${error.message}`);
  const out: Partial<Record<FlowKind, FlowInsightRow>> = {};
  for (const r of (data ?? []) as Row[]) {
    try {
      out[r.kind] = { kind: r.kind, summary: parseFlowInsight(r.summary), coveredThrough: r.covered_through, coveredCount: r.covered_count, model: r.model, generatedAt: r.generated_at };
    } catch (e) {
      reportError(e, { scope: "explore.flow.read", kind: r.kind, studentId });
    }
  }
  return out;
}

export function toFlowView(kind: FlowKind, row: FlowInsightRow | undefined): FlowInsightView {
  return {
    kind,
    label: FLOW_KIND_LABEL[kind],
    insight: row?.summary ?? null,
    generatedAt: row?.generatedAt ?? null,
    modelLabel: modelDisplayLabel(row?.model),
    coveredCount: row?.coveredCount ?? 0,
    coveredThrough: row?.coveredThrough ?? null,
  };
}

export type RefreshReason = "consultation_saved" | "manual" | "nightly";
export type RefreshResult = { status: "updated" | "unchanged" | "empty" } | { status: "failed"; error: string };

/**
 * 한 학생·한 종류를 갱신한다. 기록이 없으면 `empty`, 이전 분석 뒤 새 기록이 없으면 `unchanged`(AI 호출 없음).
 * 단 '다시 분석'(명시 버튼 · `manual`)은 새 기록이 없어도 **전체 기록으로 처음부터** 다시 분석한다 — 판단 규칙이 바뀌었거나 분석이 이상할 때
 * 고칠 길이 이것뿐이다(원장 2026-11-06). 모델 응답이 계약에 안 맞으면 저장하지 않고 `failed`.
 * 저장 직전 `settleDirection` — 마지막 기록이 90일보다 오래됐거나 퇴원생이면 '좋아지는 중·유지·엇갈림'을 '판단 보류'로(걱정은 그때의 판단으로 남긴다) ·
 * 90일 안 기록이 둘보다 적으면 '좋아지는 중'을 두지 않는다.
 * 🔑 기록은 **오늘(KST)까지만** 본다 — 예정 수강(시간표 가져오기 적용일 등)을 기록으로 세면 마지막 기록이 앞날이 되어 석 달 판정·반영 시점이
 * 함께 틀어진다(그 사이 새 기록이 '이미 반영'으로 빠진다). 예정 수강은 지금 상태 줄에 '배정 예정'으로만.
 */
export async function refreshFlowInsight(args: { tenantId: string; studentId: string; kind: FlowKind; reason: RefreshReason }): Promise<RefreshResult> {
  const { tenantId, studentId, kind, reason } = args;
  const admin = createAdminClient();
  const today = kstToday();
  try {
    const [{ data: student, error: sErr }, existing, loaded, classes] = await Promise.all([
      admin.from("students").select("id, name, school, grade, status, withdrawn_at").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
      readFlowInsights(tenantId, studentId),
      kind === "consultations" ? loadConsultationRecords(admin, tenantId, studentId) : loadTimelineRecords(admin, tenantId, studentId, today),
      // 반 이름은 보조 재료 — 못 읽어도 갱신은 한다(지금 상태 줄에 반 없이).
      loadCurrentClasses(admin, tenantId, studentId, today).catch((e: unknown) => {
        reportError(e, { scope: "explore.flow.classes", kind, studentId });
        return null;
      }),
    ]);
    if (sErr) throw new Error(sErr.message);
    if (!student) return { status: "failed", error: "학생을 찾을 수 없습니다" };
    const records = upToToday(loaded, today);
    if (records.length === 0) return { status: "empty" };
    const saved = existing[kind] ?? null;
    // 반영 시점이 앞날로 적힌 옛 분석(예정 수강을 기록으로 셌던 때 · 11-06 전)은 합산 기준이 못 된다 — 처음부터 다시.
    const stored = saved && !isFutureBasis(saved.coveredThrough, today) ? saved : null;
    const fresh0 = stored ? splitNewRecords(records, stored.coveredThrough) : records;
    if (stored && fresh0.length === 0 && reason !== "manual") return { status: "unchanged" };
    // 새 기록 없는 '다시 분석' = 이전 분석 없이 전체로(합산할 새 기록이 없다).
    const prior = stored && fresh0.length > 0 ? stored : null;
    const fresh = prior ? fresh0 : records;
    const capped = fresh.slice(-FLOW_RECORD_CAP[kind]);
    const latest = latestAt(records);
    const recent = recentCount(records, today);
    const { system, prompt } = buildFlowPrompt(kind, {
      studentLabel: `${student.name}${schoolGradeLabel(student.school, student.grade) ? `(${schoolGradeLabel(student.school, student.grade)})` : ""}`,
      prior: prior?.summary ?? null,
      priorThrough: prior?.coveredThrough ?? null,
      records: capped,
      totalCount: records.length,
      today,
      standing: standingLine(student.status, kstDateOf(student.withdrawn_at), classes, today),
      latest,
      recent,
    });
    // 호출부가 둘인 이유: 키 그룹 가드(key-groups.test)는 `meta.feature`를 **글자 그대로** 읽는다(변수·표 참조는 못 본다). 이름은 FLOW_FEATURE와 같다.
    // keyName "consultations" = 원생 AI 케어와 같은 상담 빌링 버킷(키 그룹 'consultations'와 같은 env 이름).
    const base = { system, prompt, cacheSystem: true, maxTokens: 2048, keyName: "consultations" as const };
    const { data, model } =
      kind === "consultations"
        ? await generateJSON({ ...base, keyName: "consultations", meta: { feature: "student_flow_consultations", tenantId } })
        : await generateJSON({ ...base, keyName: "consultations", meta: { feature: "student_flow_timeline", tenantId } });
    // 넘친 길이·개수는 다듬어 저장한다(2026-11-11 · 주제 60자 초과로 갱신이 통째로 실패하던 것) — 어느 칸을 손댔는지만 남긴다(학생 글 없음).
    const parsed = parseFlowInsight(data, (fields) =>
      reportWarning("흐름 분석 응답 길이 다듬음", { scope: "explore.flow.normalize", kind, studentId, fields: fields.join(",") }),
    );
    const summary = { ...parsed, direction: settleDirection(parsed.direction, { stale: !!flowRecency(latest, today)?.stale, withdrawn: student.status === "withdrawn", recent }) };
    const { error } = await admin.from("student_flow_insights").upsert(
      {
        tenant_id: tenantId,
        student_id: studentId,
        kind,
        summary,
        covered_through: latest,
        covered_count: records.length,
        model,
        reason,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,student_id,kind" },
    );
    if (error) throw new Error(`흐름 분석 저장 실패: ${error.message}`);
    return { status: "updated" };
  } catch (e) {
    reportError(e, { scope: "explore.flow.refresh", kind, studentId, reason });
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
