import "server-only";
import { cache } from "react";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/require-access";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { getStudentById, getStudentEnrollmentConsultations } from "@/features/students/server/queries";
import { canSeeStudentEnrollment } from "@/features/students/server/enrollment-gate";
import { getLiveContext, readSection, unavailableSection } from "@/features/student-contribution/server/live-context";
import { liveSectionReaders } from "@/features/student-contribution/server/live-query";
import { getStudentLearningConnections } from "@/features/student-contribution/server/learning-actions";
import { getStudentCommunicationConnections } from "@/features/student-contribution/server/communication-actions";
import { getContributionStudent } from "@/features/student-contribution/server/student-query";
import { getStudentRecordSummary } from "@/features/student-contribution/server/summary-query";
import { scoreRaws, sumRaws } from "@/features/student-contribution/model/calc";
import { getStudentCareGraph } from "@/features/student-care/server/graph";
import { studentOnboardingSection } from "@/features/newcomers/server/followup-query";
import { studentJourneySection } from "@/features/enrollment/journey/server";
import { sectionResult, type LiveSection } from "@/features/students/ontology/live-contract";
import { hubNodeId, studentHubGraph, type HubAnalysis, type HubCoverage } from "../model";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const hubMonth = (value?: string) => monthSchema.safeParse(value).success ? value! : kstMonth();
const attempt = async <T,>(read: () => Promise<T>) => {
  try { return { ok: true as const, value: await read() }; }
  catch { return { ok: false as const }; }
};

/** One student-scoped boundary shared by the screen and graph API. No academy-wide graph download/filter. */
export const getStudentHub = cache(async (studentId: string, requestedMonth?: string) => {
  if (!z.string().uuid().safeParse(studentId).success) return null;
  const user = await requireAccess("students");
  const student = await getStudentById(studentId);
  if (!student) return null;
  const month = hubMonth(requestedMonth), checkedAt = new Date().toISOString(), today = kstToday();
  const base = `/students/${studentId}`;
  const [contextRead, careRead, contributionRead, summaryRead, billingAllowed, enrollmentAllowed] = await Promise.all([
    attempt(() => getLiveContext(studentId)), attempt(() => getStudentCareGraph(studentId)),
    attempt(() => getContributionStudent(studentId, month)), attempt(() => getStudentRecordSummary(studentId)),
    canAccessTenant(user.systemRole, "billing"), canSeeStudentEnrollment(user.systemRole, studentId),
  ]);
  const context = contextRead.ok ? contextRead.value : null;
  const sections: LiveSection[] = [];
  const coverage: HubCoverage[] = [];
  if (context) {
    const [basic, learning, communication] = await Promise.all([
      Promise.all(liveSectionReaders.map((r) => readSection(r.key, r.label, base, () => r.read(context)))),
      attempt(() => getStudentLearningConnections(studentId)), attempt(() => getStudentCommunicationConnections(studentId)),
    ]);
    sections.push(...basic);
    if (learning.ok && learning.value.sections) sections.push(...learning.value.sections);
    else coverage.push({ key: "learning", label: "학습 기록", state: "failed", note: "학습 기록을 불러오지 못했습니다." });
    if (communication.ok && communication.value.sections) sections.push(...communication.value.sections);
    else coverage.push({ key: "communication", label: "소통 이력", state: "failed", note: "소통 이력을 불러오지 못했습니다." });
  } else coverage.push({ key: "live", label: "원본 기록 통합", state: contextRead.ok ? "forbidden" : "failed", note: "통합 조회 권한 또는 연결 상태를 확인해 주세요. 각 상세 탭에서 허용된 자료를 확인할 수 있습니다." });

  const billing = readSection("billing", "수납 이력", `${base}?tab=billing`, async () => {
    if (!billingAllowed) return unavailableSection("billing", "수납 이력", `${base}?tab=billing`, "forbidden");
    const db = await createClient();
    const rows = await fetchAllPaged<{ id: string; period: string; amount_total: number; amount_paid: number; amount_discount: number; status: string }>((a, b) => db.from("invoices")
      .select("id,period,amount_total,amount_paid,amount_discount,status").eq("tenant_id", user.tenantId).eq("student_id", studentId).order("period", { ascending: false }).order("id").range(a, b));
    const state: Record<string, string> = { paid: "완납", unpaid: "미납", partial: "부분납", refunded: "환불", void: "취소" };
    return { ...sectionResult("billing", "수납 이력", `${base}?tab=billing`, rows.map((r) => ({ id: r.id,
      title: `${r.period} · ${state[r.status] ?? "상태 확인 필요"}`,
      detail: `청구 ${Number(r.amount_total).toLocaleString()}원 · 할인 ${Number(r.amount_discount).toLocaleString()}원 · 납부 ${Number(r.amount_paid).toLocaleString()}원`,
      evidence: [{ source: "invoices", id: r.id, studentId, href: `${base}?tab=billing` }],
    })), rows.length), note: "현재 저장된 청구서 전체 이력입니다. 청구·납부액을 학원의 회계 매출·이익으로 해석하지 않습니다." };
  });
  const intake = readSection("intake", "입학상담·학부모 요구", `${base}?tab=consultations`, async () => {
    if (!enrollmentAllowed) return unavailableSection("intake", "입학상담·학부모 요구", `${base}?tab=consultations`, "forbidden");
    const result = await getStudentEnrollmentConsultations(studentId);
    if (result.status !== "ok") return unavailableSection("intake", "입학상담·학부모 요구", `${base}?tab=consultations`, result.status === "not_ready" ? "schema_missing" : "failed");
    return sectionResult("intake", "입학상담·학부모 요구", `${base}?tab=consultations`, result.rows.map((r) => ({ id: r.id,
      title: `${r.subject ?? "입학"} 상담`, date: r.date ?? undefined,
      detail: [r.request && `학부모 요구: ${r.request}`, r.careerGoal && `목표: ${r.careerGoal}`, r.followUp && `후속 조치: ${r.followUp}`].filter(Boolean).join(" / ") || "상세 상담 기록에서 확인해 주세요.",
      evidence: [{ source: "enrollment_consultations", id: r.id, studentId, href: `${base}?tab=consultations` }],
    })), result.rows.length);
  });
  const onboarding = readSection("onboardingFeedback", "신입생 적응·담임 피드백", `/newcomers?student=${studentId}`, async () => {
    if (!await canAccessTenant(user.systemRole, "newcomers")) return unavailableSection("onboardingFeedback", "신입생 적응·담임 피드백", base, "forbidden");
    return studentOnboardingSection(studentId);
  });
  // 아직 연결되지 않은 다른 원본은 빈 결과로 위장하지 않는다.
  for (const [key, label] of [["field-observations", "현장 관찰·후속 조치"], ["marketing", "유입 경로·홍보·행사 참여"]] as const)
    coverage.push({ key, label, state: "schema_missing", note: "이 기록 표가 아직 연결되지 않았습니다(시안). 0건으로 해석하지 않습니다." });
  // 전화·방문·등록 확인 기록(s2_0063) — 그 학생에게 이어진 상담의 기록만. 권한은 그 기능의 게이트가 본다(없으면 null → '권한 없음').
  const admissionJourney = readSection("admissionJourney", "전화·방문·등록 확인 기록", "/enrollment/visits", async () =>
    await studentJourneySection(studentId) ?? unavailableSection("admissionJourney", "전화·방문·등록 확인 기록", "/enrollment/visits", "forbidden"));
  sections.push(...await Promise.all([billing, intake, onboarding, admissionJourney]));
  const care = careRead.ok && careRead.value.graph ? careRead.value.graph : null;
  const commitments = care?.nodes.filter((n) => n.kind === "commitment") ?? [];
  if (care) sections.push({ ...sectionResult("commitments", "입학 약속·이행", `${base}/care`, commitments.map((n) => ({
    id: n.sourceId, title: String(n.attributes?.promise ?? "상담 약속"), date: String(n.attributes?.dueOn ?? ""),
    detail: `요구: ${n.attributes?.need ?? ""} / 완료 기준: ${n.attributes?.criterion ?? ""} / ${n.attributes?.state === "completed" ? "완료" : n.attributes?.state === "cancelled" ? "취소" : "진행 중"}`,
    evidence: [{ source: "commitment", id: n.sourceId, studentId, href: `${base}/care` }],
  })), commitments.length), state: careRead.ok && careRead.value.status === "partial" ? "partial" : "ready",
    note: "담당자 인수·증거·완료 처리는 약속 관리에서 이어갑니다. 90일이 지나도 미완료 약속은 남습니다." });
  else coverage.push({ key: "commitments", label: "입학 약속·이행", state: "unavailable", note: "약속 관리 권한 또는 연결 상태를 확인해 주세요." });
  const contribution = contributionRead.ok ? contributionRead.value : null;
  const selected = contribution?.months.find((m) => m.month === month);
  const facts = selected?.payload.facts ?? [];
  const analyses: HubAnalysis[] = [];
  const monthly = contribution?.ready ? contribution.months.map((m) => ({ month: m.month, computedAt: m.computedAt,
    ...scoreRaws(sumRaws([m.raws, m.correction]), contribution.settings.config), partial: !!m.unavailable.length })) : [];
  const current = monthly.find((m) => m.month === month);
  if (current) analyses.push({ id: `contribution:${month}`, title: `${month} 운영 기여·학습 참여`,
    body: `운영 기여 ${current.operations.toLocaleString()}점 · 학습·참여 ${current.participation.toLocaleString()}점. 현재 배점으로 계산한 실적 점수이며 퇴원 확률이나 학생의 가치 평가가 아닙니다.`,
    basis: "rule", generatedAt: current.computedAt, href: `${base}?tab=contribution&month=${month}`, period: month,
    evidence: facts.map((f) => hubNodeId(user.tenantId, "fact", f.id)), state: current.partial ? "partial" : "ready" });
  if (care) {
    const open = commitments.filter((n) => n.attributes?.state === "open"), overdue = open.filter((n) => String(n.attributes?.dueOn) < today);
    analyses.push({ id: "commitment-followup", title: "약속 이행 점검", body: `확인한 약속 중 진행 중 ${open.length}건, 기한 경과 ${overdue.length}건입니다. 담당자와 증거를 확인하고 후속 조치를 진행해 주세요.`,
      basis: "rule", generatedAt: checkedAt, href: `${base}/care`, evidence: commitments.map((n) => hubNodeId(user.tenantId, "commitment", n.sourceId)),
      state: careRead.ok && careRead.value.status === "partial" ? "partial" : "ready" });
  }
  if (student.aiCareSummary) analyses.push({ id: "stored-care", title: "기존 AI 케어 분석", body: student.aiCareSummary,
    basis: "ai", generatedAt: student.aiCareGeneratedAt, href: `${base}?tab=overview`, evidence: [], state: "historical" });
  const summary = summaryRead.ok ? summaryRead.value : null;
  if (summary?.state === "ready") for (const item of summary.items) analyses.push({ id: `summary:${item.itemId}`, title: item.title,
    body: item.summary ?? item.excerpt, basis: "ai", generatedAt: summary.generatedAt, href: item.href,
    evidence: sections.flatMap(s => s.items.filter(i => `${s.key}:${i.id}` === item.itemId).flatMap(i => i.evidence.map(e => hubNodeId(user.tenantId, e.source, e.id)))), state: summary.partial ? "partial" : "ready" });
  if (context && !sections.some(s => s.key === "parentMessages")) coverage.push({ key: "parentMessages", label: "클래스노트 학부모 소통", state: "off", note: "현재 설정에서 학부모 글 연결을 사용하지 않습니다. 전체 메시지가 통합되었다는 뜻은 아닙니다." });
  coverage.push(...sections.map((s) => ({ key: s.key, label: s.label, state: s.state,
    note: s.note ?? (s.total === null ? "전체 건수 확인 전" : `${s.total}건 중 ${s.items.length}건의 연결을 불러왔습니다.`) })),
    { key: "contribution", label: "기여도·설명회·소개 근거", state: selected ? "ready" : contribution ? "pending" : "unavailable", note: selected ? `${month} 근거 ${facts.length}건. 월별 점수 이력과 현재 원본의 시점은 구분합니다.` : "선택한 월의 분석 근거가 없거나 열람할 수 없습니다." },
    { key: "summary", label: "근거 기반 AI 요약", state: summary?.state ?? "unavailable", note: summary?.state === "ready" ? "현재 권한과 원본을 다시 확인한 저장 요약입니다." : "유효한 저장 요약이 없습니다. 분석이 없는 것을 이상 없음으로 판단하지 않습니다." },
    { key: "external", label: "Google Drive·Notion·카카오톡/Slack", state: "pending", note: "학생별 문서·메시지 연결이 아직 준비되지 않았습니다. 이름이 같다는 이유만으로 자동 연결하지 않습니다." },
    { key: "finance", label: "ECOUNT·학생별 수익 분석", state: "pending", note: "학원 회계자료는 경영 화면에 있습니다. 학생별 원가·이익은 배분 기준과 수강 관계를 연결한 뒤 계산합니다." },
    { key: "risk", label: "통합 이탈·성장 분석", state: "pending", note: "출결·성적·소통·약속·수납을 함께 판단하는 새 분석은 준비 중입니다." });
  const profile = { id: student.id, name: student.name, school: student.school, grade: student.grade, studentCode: student.studentCode,
    englishName: student.englishName, classnoteName: student.classnoteName, status: student.status,
    parentName: student.parentName, parentPhone: student.parentPhone, studentPhone: student.studentPhone,
    enrolledAt: student.enrolledAt, withdrawnAt: student.withdrawnAt };
  const graph = studentHubGraph({ tenant: user.tenantId, studentId, name: student.name, profile, checkedAt, month, sections, facts, care, analyses, coverage });
  return { student: profile,
    month, checkedAt, sections, analyses, coverage, monthly, graph, billingAllowed };
});
