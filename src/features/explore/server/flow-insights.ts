import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { generateJSON } from "@/lib/ai/generate";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { reportError } from "@/lib/observability/report-error";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { memoCategoryLabel } from "@/features/students/detail/memo-category";
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
  type FlowRecord,
} from "../flow-insight";

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
 * 모델 응답이 계약에 안 맞으면 저장하지 않고 `failed`.
 */
export async function refreshFlowInsight(args: { tenantId: string; studentId: string; kind: FlowKind; reason: RefreshReason }): Promise<RefreshResult> {
  const { tenantId, studentId, kind, reason } = args;
  const admin = createAdminClient();
  try {
    const [{ data: student, error: sErr }, existing, records] = await Promise.all([
      admin.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
      readFlowInsights(tenantId, studentId),
      kind === "consultations" ? loadConsultationRecords(admin, tenantId, studentId) : loadTimelineRecords(admin, tenantId, studentId),
    ]);
    if (sErr) throw new Error(sErr.message);
    if (!student) return { status: "failed", error: "학생을 찾을 수 없습니다" };
    if (records.length === 0) return { status: "empty" };
    const prior = existing[kind] ?? null;
    const fresh = prior ? splitNewRecords(records, prior.coveredThrough) : records;
    if (prior && fresh.length === 0) return { status: "unchanged" };
    const capped = fresh.slice(-FLOW_RECORD_CAP[kind]);
    const { system, prompt } = buildFlowPrompt(kind, {
      studentLabel: `${student.name}${schoolGradeLabel(student.school, student.grade) ? `(${schoolGradeLabel(student.school, student.grade)})` : ""}`,
      prior: prior?.summary ?? null,
      priorThrough: prior?.coveredThrough ?? null,
      records: capped,
      totalCount: records.length,
    });
    // 호출부가 둘인 이유: 키 그룹 가드(key-groups.test)는 `meta.feature`를 **글자 그대로** 읽는다(변수·표 참조는 못 본다). 이름은 FLOW_FEATURE와 같다.
    // keyName "consultations" = 원생 AI 케어와 같은 상담 빌링 버킷(키 그룹 'consultations'와 같은 env 이름).
    const base = { system, prompt, cacheSystem: true, maxTokens: 2048, keyName: "consultations" as const };
    const { data, model } =
      kind === "consultations"
        ? await generateJSON({ ...base, keyName: "consultations", meta: { feature: "student_flow_consultations", tenantId } })
        : await generateJSON({ ...base, keyName: "consultations", meta: { feature: "student_flow_timeline", tenantId } });
    const summary = parseFlowInsight(data);
    const { error } = await admin.from("student_flow_insights").upsert(
      {
        tenant_id: tenantId,
        student_id: studentId,
        kind,
        summary,
        covered_through: latestAt(records),
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

type Admin = ReturnType<typeof createAdminClient>;

const CATEGORY_LABEL: Record<string, string> = { general: "일반", academic: "학습/성적", emotional: "정서/심리", career: "진로", social: "교우관계", other: "기타" };
const AUDIENCE_LABEL: Record<string, string> = { parent: "학부모", student: "학생", both: "학부모+학생" };

/** 상담 기록 → 한 줄씩(오래된 것부터). 내부 링크 조각은 뗀다(`visibleConsultationSummary`). */
async function loadConsultationRecords(admin: Admin, tenantId: string, studentId: string): Promise<FlowRecord[]> {
  const rows = await fetchAllPaged<{
    consulted_at: string; category: string | null; audience: string | null; summary: string; follow_up_action: string | null; follow_up_date: string | null; follow_up_done: boolean | null;
    counselor: { display_name?: string } | { display_name?: string }[] | null;
  }>((from, to) =>
    admin.from("student_consultations").select("consulted_at, category, audience, summary, follow_up_action, follow_up_date, follow_up_done, counselor:counselor_id ( display_name )")
      .eq("tenant_id", tenantId).eq("student_id", studentId).order("consulted_at", { ascending: true }).order("id").range(from, to),
  );
  return rows.map((r) => {
    const who = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor)?.display_name;
    const head = [r.category ? CATEGORY_LABEL[r.category] ?? r.category : null, r.audience ? AUDIENCE_LABEL[r.audience] ?? r.audience : null, who ? `상담자 ${who}` : null].filter(Boolean).join(" · ");
    const follow = r.follow_up_action ? ` / 후속 조치: ${r.follow_up_action}${r.follow_up_date ? `(${r.follow_up_date})` : ""}${r.follow_up_done ? " — 완료" : ""}` : "";
    return { at: r.consulted_at, text: `${head ? `(${head}) ` : ""}${visibleConsultationSummary(r.summary).replace(/\s+/g, " ").slice(0, 600)}${follow}` };
  });
}

/**
 * 타임라인 기록 → 한 줄씩(오래된 것부터). 원생 상세 타임라인과 같은 출처 다섯(수강 · 상담 · 메모 · 성적 · 재원 상태) —
 * 세션이 없는 밤 배치에서도 돌아야 해서 admin 클라이언트로 따로 읽는다(지점 필터 필수).
 */
async function loadTimelineRecords(admin: Admin, tenantId: string, studentId: string): Promise<FlowRecord[]> {
  const [enrolls, consults, memos, grades, { data: student }] = await Promise.all([
    fetchAllPaged<{ start_date: string; end_date: string | null; is_transferred: boolean | null; class: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[] | null }>((from, to) =>
      admin.from("enrollments").select("start_date, end_date, is_transferred, class:class_id ( class_name, subject )").eq("tenant_id", tenantId).eq("student_id", studentId).order("start_date").range(from, to)),
    loadConsultationRecords(admin, tenantId, studentId),
    fetchAllPaged<{ created_at: string; category: string | null; content: string }>((from, to) =>
      admin.from("student_memos").select("created_at, category, content").eq("tenant_id", tenantId).eq("student_id", studentId).order("created_at").range(from, to)),
    fetchAllPaged<{ taken_on: string; exam_name: string | null; subject: string | null; score: number | null; max_score: number | null }>((from, to) =>
      admin.from("student_grades").select("taken_on, exam_name, subject, score, max_score").eq("tenant_id", tenantId).eq("student_id", studentId).order("taken_on").range(from, to)),
    admin.from("students").select("enrolled_at, withdrawn_at, status").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const out: FlowRecord[] = [];
  for (const e of enrolls) {
    const c = Array.isArray(e.class) ? e.class[0] : e.class;
    const name = c?.class_name ?? "반";
    out.push({ at: e.start_date, text: `${name} 수강 시작` });
    if (e.end_date && e.end_date <= today) out.push({ at: e.end_date, text: `${name} ${e.is_transferred ? "반 이동으로 종료" : "수강 종료"}` });
  }
  for (const c of consults) out.push({ at: c.at, text: `상담: ${c.text.slice(0, 300)}` });
  for (const m of memos) out.push({ at: m.created_at, text: `특이사항(${memoCategoryLabel(m.category)}): ${m.content.replace(/\s+/g, " ").slice(0, 200)}` });
  for (const g of grades) out.push({ at: g.taken_on, text: `시험 ${g.exam_name ?? ""}${g.subject ? ` (${g.subject})` : ""}: ${g.score ?? "—"}${g.max_score != null ? `/${g.max_score}` : ""}` });
  if (student?.enrolled_at) out.push({ at: String(student.enrolled_at).slice(0, 10), text: "재원 시작" });
  if (student?.withdrawn_at && String(student.withdrawn_at).slice(0, 10) <= today) out.push({ at: String(student.withdrawn_at).slice(0, 10), text: "퇴원" });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 밤 배치 후보 — 한 지점에서 **타임라인 분석이 없거나, 마지막 분석 뒤 새 기록이 생긴 재원생**(상한 `limit`). 학생마다 묻지 않고
 * 지점 단위로 네 출처의 최근 기록을 한 번씩 읽어 학생별 최신 시점을 만든다(B2 — 페이징 · 집계는 JS지만 지점당 수백 행).
 */
export async function timelineRefreshCandidates(tenantId: string, limit: number): Promise<string[]> {
  const admin = createAdminClient();
  const [students, rows] = await Promise.all([
    fetchAllPaged<{ id: string }>((from, to) => admin.from("students").select("id").eq("tenant_id", tenantId).eq("status", "enrolled").order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; covered_through: string | null }>((from, to) =>
      admin.from("student_flow_insights").select("student_id, covered_through").eq("tenant_id", tenantId).eq("kind", "timeline").order("id").range(from, to)),
  ]);
  const covered = new Map(rows.map((r) => [r.student_id, r.covered_through ?? ""]));
  const enrolled = new Set(students.map((s) => s.id));
  const fresh = students.filter((s) => !covered.has(s.id)).map((s) => s.id);
  // 분석이 있는 학생은 마지막 반영 시점 뒤 기록이 있을 때만 — 가장 오래된 반영 시점 뒤의 기록만 읽는다.
  const floor = [...covered.values()].filter(Boolean).sort()[0] ?? null;
  const changed = new Set<string>();
  if (floor) {
    const [c, m, g, e] = await Promise.all([
      fetchAllPaged<{ student_id: string; consulted_at: string }>((from, to) => admin.from("student_consultations").select("student_id, consulted_at").eq("tenant_id", tenantId).gt("consulted_at", floor).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; created_at: string }>((from, to) => admin.from("student_memos").select("student_id, created_at").eq("tenant_id", tenantId).gt("created_at", floor).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; taken_on: string }>((from, to) => admin.from("student_grades").select("student_id, taken_on").eq("tenant_id", tenantId).gt("taken_on", floor.slice(0, 10)).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; start_date: string; end_date: string | null }>((from, to) => admin.from("enrollments").select("student_id, start_date, end_date").eq("tenant_id", tenantId).or(`start_date.gt.${floor.slice(0, 10)},end_date.gt.${floor.slice(0, 10)}`).order("id").range(from, to)),
    ]);
    const mark = (sid: string, at: string) => {
      const through = covered.get(sid);
      if (through !== undefined && enrolled.has(sid) && at > through) changed.add(sid);
    };
    for (const r of c) mark(r.student_id, r.consulted_at);
    for (const r of m) mark(r.student_id, r.created_at);
    for (const r of g) mark(r.student_id, r.taken_on);
    const today = new Date().toISOString().slice(0, 10);
    for (const r of e) {
      mark(r.student_id, r.start_date);
      if (r.end_date && r.end_date <= today) mark(r.student_id, r.end_date);
    }
  }
  return [...changed, ...fresh].slice(0, limit);
}
