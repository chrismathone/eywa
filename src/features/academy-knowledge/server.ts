import "server-only";
import { z } from "zod";
import { loadOkrWorkspace } from "@/features/organization-okr/server";
import { workAccess } from "@/features/work-records/server";
import { getStudentHub } from "@/features/student-hub/server/query";
import { getFactorWorkspace } from "@/features/student-contribution/server/factor-query";
import { factorGraph } from "@/features/student-contribution/model/factors";
import { loadTeacherHub } from "@/features/teacher-hub/server";
import { readableFactStudents } from "@/features/student-contribution/server/fact-access";
import { periodBounds } from "@/features/management/model";
import { addDays, kstToday } from "@/lib/date-kst";
import { loadKnowledgeRecords, loadKnowledgeStudents } from "./server-records";
import { loadCoreGraph } from "./server-core";
import { addNativeGraph, unifyGraphs, type SourceGraph } from "./graph";
import { evaluateRules, observationFacts } from "./rules";
import { knowledgeGate, knowledgeSourceScope, loadStudioStore } from "./studio-server";
import { applyStudioLinks } from "./studio-model";
import { maskStaffNames } from "./staff-mask";
import type { KnowledgeRecord } from "./records";
import type { FieldAudit } from "./types";

/**
 * 통합 지식그래프 — aywa-next(4cd839b5e~375d27df4)의 조립을 옮겼다(2026-11-11). 문 = '경영 분석·지식그래프'(management).
 * 출처마다 따로 읽고 **실패한 출처는 상태 칸에 밝힌다**(빈 결과를 '기록 없음'으로 위장하지 않는다).
 * 🔴 aywa-next의 경영(청구·회계)·홍보(캠페인·접점) 그래프는 main에 아직 그 조회가 없어 싣지 않는다 — 바탕은 수강 관계(server-core.ts).
 * 페이지 로드는 AI를 부르지 않는다(이 화면엔 AI 호출이 없다).
 */
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

export async function loadAcademyKnowledge(input: { month?: string; student?: string; teacher?: string }) {
  const gate = await knowledgeGate(), tenant = gate.user.tenantId, today = kstToday(), month = input.month ?? today.slice(0, 7);
  if (!MONTH.test(month) || month > today.slice(0, 7)) throw Error("분석 월을 확인해 주세요");
  for (const id of [input.student, input.teacher]) if (id && !z.uuid().safeParse(id).success) throw Error("조회할 대상을 확인해 주세요");
  const end = periodBounds(month).end, asOf = end < today ? end : today, from = addDays(asOf, -29);
  const status: { name: string; state: string; detail: string }[] = [], sources: { name: string; graph: SourceGraph }[] = [];
  // 학생·직원·반은 원본 화면의 권한을 따른다(knowledgeSourceScope) — 권한 밖이면 이름·선택지를 싣지 않고 상태 칸에 밝힌다.
  const scope = await knowledgeSourceScope(gate), staffOk = scope.staff, staffSubjects = scope.staffSubjects, classScope = scope.classes;
  // 학생 이름·선택지 = 원생목록(students) 열람 + 담당 범위 안에서만.
  const [students, workAll] = await Promise.all([scope.students ? readableFactStudents().then(r => loadKnowledgeStudents(tenant, r)) : [], workAccess().then(g => g.seeReview, () => false)]);
  if (input.student && !students.some(s => s.id === input.student)) throw Error("대상 학생을 확인해 주세요");
  const studentIds = new Set(students.map(s => s.id));
  if (input.teacher && !staffOk) throw Error("조회할 대상을 확인해 주세요");
  // 직원을 전부 볼 수 없는 사람(직원관리 권한 없음 · 과목 범위 있음)에게는 합친 그래프에서 직원 이름을 가린다.
  const maskStaff = !staffOk || !!staffSubjects;
  const [core, okr, recordData, studioResult] = await Promise.all([
    loadCoreGraph(tenant, asOf, studentIds, { includeWork: workAll, staff: staffOk, staffSubjects, classes: classScope, userId: gate.user.id, includeNames: maskStaff }),
    loadOkrWorkspace().then(v => v, () => null),
    loadKnowledgeRecords().then(v => v, () => null),
    loadStudioStore().then(value => ({ value, error: "" }), () => ({ value: { rows: [], history: [], canWrite: false }, error: "모델 저장소를 조회하지 못했습니다. 기본 모델을 표시하며 편집은 잠시 중지됩니다." })),
  ]);
  sources.push({ name: "management", graph: core.graph });
  status.push(classScope === "none" ? { name: "수강·담당", state: "조회 또는 권한 확인 필요", detail: "수업목록 열람 권한이 있어야 반·수강 관계가 보입니다" }
    : { name: "수강·담당", state: "연결", detail: `${asOf} 기준 ${typeof classScope === "object" ? "내가 가르치는 반 " : ""}수강 ${core.activeEnrollments.toLocaleString()}건${staffOk ? "" : " · 직원 이름은 직원관리 열람 권한이 있어야 보입니다"}` });
  status.push(workAll ? { name: "업무 문서", state: "연결", detail: `검토 요청·확인된 문서 ${core.workRecords}건` } : { name: "업무 문서", state: "조회 또는 권한 확인 필요", detail: "업무 작성센터 검토 권한이 있어야 함께 보입니다" });
  status.push({ name: "운영·재무", state: "연결 전", detail: "청구·회계 그래프는 경영 분석 조회가 들어온 뒤 연결합니다(0건으로 해석하지 않습니다)" });
  status.push({ name: "홍보·행사", state: "연결 전", detail: "캠페인·접점 기록은 연간 운영계획·홍보 화면이 실제 기록으로 바뀐 뒤 연결합니다" });
  if (okr) { sources.push({ name: "organization-okr", graph: okr.graph }); status.push({ name: "조직·OKR", state: "연결", detail: `열람 가능한 현재 목표 ${okr.rows.filter(r => r.document.state !== "archived").length}개 · 기준일 과거 스냅샷 아님` }); }
  else status.push({ name: "조직·OKR", state: "조회 또는 권한 확인 필요", detail: "조직·OKR 화면에서 열람 권한을 확인해 주세요" });
  if (input.teacher && !core.staff.some(s => s.id === input.teacher)) throw Error("조회할 대상을 확인해 주세요");
  const [hub, factors, teacherHub] = await Promise.all([
    input.student ? getStudentHub(input.student, month).catch(() => null) : null,
    input.student ? getFactorWorkspace(input.student, month).catch(() => null) : null,
    input.teacher ? loadTeacherHub({ teacherId: input.teacher, month }).catch(() => null) : null,
  ]);
  if (input.student) {
    if (hub) { sources.push({ name: "student", graph: hub.graph }); status.push({ name: "학생 통합", state: "연결", detail: hub.coverage.map(c => `${c.label}: ${c.state}`).join(" / ") }); }
    else status.push({ name: "학생 통합", state: "조회 실패", detail: "원본 조회를 다시 확인해 주세요" });
    if (factors) { sources.push({ name: "factors", graph: factorGraph(input.student, month, factors.observations) }); status.push({ name: "기여도 팩터", state: factors.storageReady ? "연결" : "일부 확인", detail: factors.warnings.join(" / ") || "확인값·부분 관측·미측정은 구분되어 있습니다" }); }
    else status.push({ name: "기여도 팩터", state: "열람 또는 조회 제한", detail: "기여도 상세 화면에서 확인해 주세요" });
  }
  if (input.teacher) {
    if (teacherHub) { sources.push({ name: "teacher", graph: teacherHub.graph }); status.push({ name: "강사 통합", state: "연결", detail: teacherHub.coverage.map(c => `${c.label}: ${c.state}`).join(" / ") }); }
    else status.push({ name: "강사 통합", state: "열람 또는 조회 제한", detail: "수업 평가 화면에서 확인해 주세요" });
  }
  const records: KnowledgeRecord[] = (recordData?.records ?? []).filter(r => r.document.date <= asOf);
  const facts = input.student ? observationFacts(records, input.student, from, asOf) : {};
  const ruleResults = input.student ? evaluateRules(facts, from, asOf) : input.teacher ? evaluateRules({}, from, asOf, "teacher") : [];
  let graph = unifyGraphs(tenant, new Date().toISOString(), sources);
  // 이름은 원본 기록에서만 붙인다 — 이름으로 사람을 잇지 않는다.
  const names = new Map(students.map(s => [`${tenant}:student:${s.id}`, s.name]));
  graph.nodes = graph.nodes.map(n => names.has(n.id) ? { ...n, label: names.get(n.id)! } : n);
  graph = addNativeGraph(graph, records, students, core.staff, ruleResults, input.student);
  for (const p of students.filter(p => core.activeStudents.has(p.id) && p.school)) {
    const sid = `${tenant}:school:${p.school}:${p.grade ?? "미기재"}`;
    if (!graph.nodes.some(n => n.id === sid)) graph.nodes.push({ id: sid, type: "School", label: `${p.school} ${p.grade ?? ""}`.trim(), source: "현재 학생 기본정보", period: today });
    graph.edges.push({ from: `${tenant}:student:${p.id}`, to: sid, relation: "STUDIES_AT", sourceRelation: "school,grade", basis: "현재 학적 정보 · 과거 학적 복원 아님", evidence: [], asOf: today });
  }
  status.push(recordData
    ? { name: "직접 입력", state: "연결", detail: `기준일까지 ${records.length}개 최신 기록 · 모든 변경 버전 보관` }
    : { name: "직접 입력", state: "조회 또는 권한 확인 필요", detail: "관찰·후속 조치 기록은 업무 작성센터 권한이 있어야 함께 보입니다" });
  status.push({ name: "Drive·Notion·Calendar·Slack·ClassNote", state: "상시 수집 미완료", detail: "이미 가져온 근거와 향후 자동 수집은 구분합니다. 동일 학생 ID 확인 없이 병합하지 않습니다." });
  graph = applyStudioLinks(graph, studioResult.value.rows, asOf);
  // 🔴 직원 이름은 마지막에 한 번 더 거른다(staff-mask.ts) — 다른 출처(조직·OKR · 학생/강사 통합 · 직접 기록)가 실어 온 직원 노드와
  //    시스템이 제목·상세에 붙인 이름("작성 ○○○ · …")에도 실명이 있다. 볼 수 없는 직원의 이름 목록은 서버 안에서만 쓴다.
  if (maskStaff) graph = maskStaffNames(graph, gate.user.id, new Set(core.staff.map(s => s.id)), core.hiddenStaffNames);
  return { month, today, asOf, from, graph, ruleResults, status, records, students, staff: core.staff,
    activeProfiles: students.filter(s => core.activeStudents.has(s.id)), selectedStudent: input.student ?? "", selectedTeacher: input.teacher ?? "",
    // 원본 빈값 전수 점검(학생·강좌·직원 표를 다 읽는다)은 화면을 열 때마다 돌지 않는다 — '보완 점검'의 버튼을 누를 때만(GET /api/management/model).
    studio: { ...studioResult.value, error: studioResult.error, audit: { fields: [] as FieldAudit[], errors: [] as string[], asOf: today, ran: false } } };
}
export type AcademyKnowledgeData = Awaited<ReturnType<typeof loadAcademyKnowledge>>;
