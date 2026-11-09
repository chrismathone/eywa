import { addDays } from "@/lib/date-kst";
import type { Metric } from "@/features/management/model";
import { periodBounds } from "@/features/management/model";
import { sampleManagement } from "@/features/management/sample-data";
import { addNativeGraph, unifyGraphs, type Graph, type SourceGraph } from "./graph";
import type { KnowledgeDocument, KnowledgeRecord } from "./records";
import { evaluateRules, observationFacts, type RuleResult } from "./rules";
import { applyStudioLinks, type StudioRow } from "./studio-model";
import { liveHref } from "./routes";

/**
 * 통합 지식그래프 · 관찰·후속 조치 시안의 예시 값 — 🔴 DB를 읽지 않는다
 * (academy_knowledge_records · academy_model_versions · marketing_* 표가 이 DB에 없다). 이름은 지어낸 값이다.
 * 그래프는 원래 화면과 같은 순수 함수(unifyGraphs · addNativeGraph · evaluateRules)로 조립한다.
 */
export type Person = { id: string; name: string; school: string | null; grade: string | null };
export type Staff = { id: string; display_name: string };
export type FieldAudit = { key: string; total: number; missing: number; scope: string; examples: { label: string; href: string }[] };
export type KnowledgeRecordsData = {
  records: KnowledgeRecord[]; history: KnowledgeRecord[]; students: Person[]; users: Staff[];
  campaigns: { id: string; label: string }[]; today: string; actorId: string; canReview: boolean; canWrite: boolean;
};
export type AcademyKnowledgeData = {
  month: string; today: string; asOf: string; from: string; graph: Graph; ruleResults: RuleResult[];
  status: { name: string; state: string; detail: string }[]; records: KnowledgeRecord[];
  students: Person[]; staff: Staff[]; activeProfiles: Person[]; selectedStudent: string; selectedTeacher: string;
  metrics: Metric[]; periodStart: string;
  studio: { rows: StudioRow[]; history: StudioRow[]; canWrite: boolean; error: string; audit: { fields: FieldAudit[]; errors: string[]; asOf: string } };
};

const TENANT = "sample";
const uid = (kind: number, n: number) => `5a1e${String(kind).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STAFF_NAMES = ["김하늘", "이도윤", "박서준", "최유나", "정민호", "한지우", "오세린", "윤태오", "송가람", "남궁하은"];
export const SAMPLE_STAFF: Staff[] = STAFF_NAMES.map((display_name, i) => ({ id: uid(2, i + 1), display_name }));
const [KIM, LEE, PARK, CHOI, , , , , SONG, NAMGUNG] = SAMPLE_STAFF.map(s => s.id);

const STUDENT_NAMES = ["강하린", "문서윤", "백지호", "신예준", "안수아", "임하준", "장채원", "조민준", "진서아", "차도현", "표유진", "홍시우", "고은채", "권태윤", "나다온", "류지안", "명하율", "봉서준", "석가은", "유한결"];
const SCHOOLS = [["하늘중", "2학년"], ["솔빛중", "3학년"], ["푸른고", "1학년"], ["새봄초", "6학년"], ["하늘중", "1학년"]] as const;
export const SAMPLE_STUDENTS: Person[] = Array.from({ length: 60 }, (_, i) => {
  const [school, grade] = SCHOOLS[i % SCHOOLS.length]!;
  const base = STUDENT_NAMES[i % STUDENT_NAMES.length]!;
  return { id: uid(1, i + 1), name: i < STUDENT_NAMES.length ? base : `${base}${String.fromCharCode(65 + Math.floor(i / STUDENT_NAMES.length) - 1)}`, school, grade };
});
const S = (n: number) => SAMPLE_STUDENTS[n - 1]!.id;
const CLASSES = ["중2 수학 A", "중2 수학 B", "중3 수학 심화", "고1 수학", "초6 수학", "중2 영어 A", "중3 영어", "고1 영어", "EiE 리딩 3", "EiE 스피킹 2"];
const CAMPAIGNS = [{ id: uid(3, 1), label: "가을 학부모 설명회" }, { id: uid(3, 2), label: "하늘중 기말 대비 블로그 연재" }, { id: uid(3, 3), label: "아파트 엘리베이터 광고" }];

/** 관찰 기간(최근 30일)은 기준일에서 계산한다 — 규칙 판정이 같은 기간의 관찰만 쓰기 때문이다. */
function sampleRecords(asOf: string): KnowledgeRecord[] {
  const from = addDays(asOf, -29), at = (d: number) => `${addDays(asOf, -d)}T09:00:00.000Z`;
  const rec = (n: number, author: string, version: number, daysAgo: number, document: KnowledgeDocument): KnowledgeRecord =>
    ({ id: uid(9, n * 10 + version), record_id: uid(8, n), version, author_id: author, actor_id: author, recorded_at: at(daysAgo), document });
  const obs = (extra: Omit<Extract<KnowledgeDocument, { kind: "observation" }>, "kind" | "date" | "from" | "through">) => ({ kind: "observation" as const, date: asOf, from, through: asOf, ...extra });
  return [
    rec(1, KIM!, 2, 1, obs({ title: "강하린 10월 출석 저하", studentId: S(1), role: "homeroom", signal: "attendance", value: 72, severity: 2, fact: "예정 수업 25회 중 18회 출석(결석 5 · 지각 2).", interpretation: "학교 수행평가 기간과 겹친 것으로 보임", evidence: "출석부 원스크린 10월 기록", state: "confirmed" })),
    rec(2, SONG!, 1, 2, obs({ title: "강하린 보호자 연결 상담 없음", studentId: S(1), role: "counsel", signal: "calls", value: 0, severity: 2, fact: "최근 30일 보호자와 연결된 상담 기록이 없습니다.", interpretation: "", evidence: "학생 상담 목록 조회", state: "confirmed" })),
    rec(3, NAMGUNG!, 1, 3, obs({ title: "강하린 타 학원 체험 수업 언급", studentId: S(1), role: "deputy", signal: "competitor", value: 1, severity: 3, fact: "하원 중 친구에게 다른 학원 체험 수업을 다녀왔다고 말함.", interpretation: "보호자 의견 확인 필요", evidence: "부원장 하원 지도 중 직접 들음", state: "confirmed" })),
    rec(4, CHOI!, 1, 4, obs({ title: "문서윤 재시험 2회 연속", studentId: S(2), role: "homeroom", signal: "retest", value: 2, severity: 2, fact: "단어 시험 재시험 2회 연속 통과하지 못함.", interpretation: "", evidence: "ECS 주간 시트", state: "submitted" })),
    rec(5, SONG!, 1, 6, obs({ title: "백지호 하원 시간 불일치", studentId: S(3), role: "desk", signal: "mismatch", value: 1, severity: 1, fact: "셔틀 탑승 기록과 하원 체크 시각이 20분 다름.", interpretation: "", evidence: "셔틀 탑승 명단·키오스크 기록", state: "confirmed" })),
    rec(6, KIM!, 1, 1, { kind: "action", title: "출석 저하와 상담 공백", date: asOf, evidence: "R2 검토 규칙 · 강하린 관찰 2건", studentId: S(1), ownerId: KIM!, due: addDays(asOf, 2), originId: uid(8, 1), ruleId: "R2", plan: "48시간 내 보호자 상담을 계획하고 연결 결과 기록", result: "", state: "open" }),
    rec(7, LEE!, 2, 9, { kind: "action", title: "백지호 하원 동선 확인", date: addDays(asOf, -9), evidence: "데스크 관찰 · 셔틀 명단", studentId: S(3), ownerId: SONG!, due: addDays(asOf, -5), originId: uid(8, 5), ruleId: null, plan: "보호자와 하원 방법 확인", result: "목요일만 보호자 픽업으로 변경됨을 확인하고 명단 수정", state: "done" }),
    rec(8, NAMGUNG!, 1, 12, { kind: "okr", title: "신입생 90일 유지율", date: addDays(asOf, -12), evidence: "신입생 관리 화면 9~10월 등록생", ownerId: NAMGUNG!, from: addDays(asOf, -60), through: asOf, objective: "새로 온 학생이 석 달 안에 자리 잡게 한다", keyResult: "90일 유지율 84% → 92%", baseline: 84, target: 92, actual: 88, direction: "higher", unit: "%", metricId: "withdrawal_rate", state: "active" }),
    rec(9, NAMGUNG!, 1, 20, { kind: "population", title: "하늘중 2학년 전체 학생 수", date: addDays(asOf, -20), evidence: "학교알리미 2026 공시", school: "하늘중", grade: "2학년", total: 286 }),
    rec(10, NAMGUNG!, 1, 25, { kind: "content", title: "기말 대비 블로그 3편 성과", date: addDays(asOf, -25), evidence: "블로그 통계 화면 캡처", campaignId: CAMPAIGNS[1]!.id, url: "https://blog.example.com/sample-post", publishedOn: addDays(asOf, -40), from: addDays(asOf, -40), through: addDays(asOf, -26), views: 1840, visits: 212, inquiries: 7, registrations: 2 }),
    rec(11, NAMGUNG!, 1, 15, { kind: "staffing", title: "데스크 업무량", date: addDays(asOf, -15), evidence: "데스크 업무 일지 2주", role: "데스크·상담 응대", from: addDays(asOf, -29), through: addDays(asOf, -15), requiredHours: 168, productiveHours: 70, currentPeople: 2 }),
    rec(12, PARK!, 1, 5, obs({ title: "신예준 수업 불편 호소", studentId: S(4), role: "homeroom", signal: "complaint", value: 1, severity: 2, fact: "판서가 잘 안 보인다고 두 번 말함.", interpretation: "자리 배치 변경 검토", evidence: "수업 중 직접 들음", state: "submitted" })),
  ];
}
/** 옛 버전 한 줄 — 변경 이력 화면에 v1이 보이게. */
function withHistory(records: KnowledgeRecord[]): KnowledgeRecord[] {
  const old = records.filter(r => r.version > 1).map(r => ({ ...r, id: `${r.id}-v1`, version: 1, recorded_at: r.recorded_at.replace("T09", "T07") }));
  return [...old, ...records];
}

function sourceGraph(asOf: string): SourceGraph {
  const nodes: SourceGraph["nodes"] = [], edges: SourceGraph["edges"] = [];
  CLASSES.forEach((label, c) => { nodes.push({ id: `class:${uid(4, c + 1)}`, label, type: "Class", source: "예시 반" }); edges.push({ from: `class:${uid(4, c + 1)}`, to: `teacher:${SAMPLE_STAFF[c % 8]!.id}`, relation: "currently_taught_by", basis: "현재 반 담당자" }); });
  SAMPLE_STAFF.slice(0, 8).forEach(t => nodes.push({ id: `teacher:${t.id}`, label: t.display_name, type: "Instructor", source: "예시 직원" }));
  SAMPLE_STUDENTS.forEach((p, i) => {
    nodes.push({ id: `student:${p.id}`, label: p.name, type: "Student", source: "예시 학생" });
    for (const c of [i % 5, 5 + (i % 5)].slice(0, i % 3 === 0 ? 1 : 2)) edges.push({ from: `student:${p.id}`, to: `class:${uid(4, c + 1)}`, relation: "enrolled_in", basis: `예시 수강 · 기준 ${asOf}` });
    const school = `school:${p.school}:${p.grade}`;
    if (!nodes.some(n => n.id === school)) nodes.push({ id: school, label: `${p.school} ${p.grade}`, type: "School", source: "현재 학생 기본정보" });
    edges.push({ from: `student:${p.id}`, to: school, relation: "STUDIES_AT", basis: "현재 학적 정보" });
    if (i < 48) { const inv = `invoice:${uid(5, i + 1)}`; nodes.push({ id: inv, label: asOf.slice(0, 7), type: "Invoice", source: "예시 청구" }); edges.push({ from: inv, to: `student:${p.id}`, relation: "billed_to", basis: "student_id" }); }
    if (i < 30) { const lr = `lesson_report:${uid(6, i + 1)}`; nodes.push({ id: lr, label: `${p.name} 수업보고서`, type: "LessonReport", source: "예시 수업보고서", date: asOf }); edges.push({ from: lr, to: `student:${p.id}`, relation: "RELATED_RECORD", basis: "보고서의 학생 ID" }); }
    if (i < 14) { const sc = `student_consultations:${uid(7, i + 1)}`; nodes.push({ id: sc, label: `${p.name} 상담`, type: "Consultation", source: "예시 상담" }); edges.push({ from: sc, to: `student:${p.id}`, relation: "RELATED_RECORD", basis: "상담의 학생 ID" }); }
    if (i % 9 === 0) { const nc = `newcomer_checks:${uid(10, i + 1)}`; nodes.push({ id: nc, label: `${p.name} 90일 체크`, type: "CareTask", source: "예시 신입생 관리", state: i === 0 ? "pending" : undefined }); edges.push({ from: nc, to: `student:${p.id}`, relation: "RELATED_RECORD", basis: "체크리스트의 학생 ID" }); }
  });
  CAMPAIGNS.forEach((c, k) => {
    nodes.push({ id: `campaign:${c.id}`, label: c.label, type: "Campaign", source: "예시 홍보" });
    const ch = `channel:${["설명회", "블로그", "옥외 광고"][k]}`;
    nodes.push({ id: ch, label: ["설명회", "블로그", "옥외 광고"][k]!, type: "Channel", source: "예시 홍보" });
    edges.push({ from: `campaign:${c.id}`, to: ch, relation: "uses_channel", basis: "캠페인 매체" });
    for (let t = 0; t < 4 - k; t++) { const touch = `touch:${uid(11, k * 10 + t + 1)}`; nodes.push({ id: touch, label: `${c.label} 참석`, type: "Touchpoint", source: "예시 접점" }); edges.push({ from: touch, to: `campaign:${c.id}`, relation: "RELATED_RECORD", basis: "같은 캠페인 ID" }); edges.push({ from: touch, to: `student:${S(t + 1 + k * 4)}`, relation: "RELATED_RECORD", basis: "확인된 참석 학생" }); }
  });
  ["net_billed", "active_students", "withdrawal_rate", "operating_margin"].forEach(m => nodes.push({ id: `metric:${m}`, label: { net_billed: "실청구액", active_students: "기준일 수강 학생", withdrawal_rate: "월초 수강 집단 퇴원율", operating_margin: "ECOUNT 기재 영업이익률" }[m]!, type: "Metric", source: "예시 지표" }));
  edges.push({ from: "orphan:1", to: "student:missing", relation: "RELATED_RECORD", basis: "원본 ID 확인 필요" });
  return { nodes, edges };
}

function studioRows(asOf: string): { rows: StudioRow[]; history: StudioRow[] } {
  const at = (d: number) => `${addDays(asOf, -d)}T10:00:00.000Z`;
  const history: StudioRow[] = [
    { key: "field:10_학생:4", version: 1, actor_id: NAMGUNG!, recorded_at: at(20), document: { kind: "field", sheet: "10_학생", field: "4", label: "학년", required: false, note: "학적 기준 학년" } },
    { key: "field:10_학생:4", version: 2, actor_id: NAMGUNG!, recorded_at: at(8), document: { kind: "field", sheet: "10_학생", field: "4", label: "학년", required: true, note: "3월 1일 기준 학적 학년. 진급은 학년도 바뀔 때 일괄 반영" } },
    { key: "field:10_학생:5", version: 1, actor_id: NAMGUNG!, recorded_at: at(8), document: { kind: "field", sheet: "10_학생", field: "5", label: "등록일", required: true, note: "첫 수업일이 아니라 등록 확정일" } },
    { key: "expectation:student-consultation", version: 1, actor_id: NAMGUNG!, recorded_at: at(6), document: { kind: "expectation", label: "상담 기록", subject: "Student", target: "Consultation", minimum: 1, active: true } },
    { key: `link:${uid(12, 1)}`, version: 1, actor_id: SONG!, recorded_at: at(2), document: { kind: "link", from: `${TENANT}:student:${S(1)}`, to: `${TENANT}:campaign:${CAMPAIGNS[0]!.id}`, label: "설명회 소개로 등록", basis: "입학 상담지에 '가을 설명회에서 듣고 옴' 기재", date: addDays(asOf, -2), state: "pending" } },
  ];
  const latest = new Map<string, StudioRow>();
  for (const r of history) if ((latest.get(r.key)?.version ?? 0) < r.version) latest.set(r.key, r);
  return { rows: [...latest.values()], history };
}

const AUDIT: FieldAudit[] = [
  { key: "field:10_학생:4", total: 60, missing: 3, scope: "전체 학생 · 병합·검증용 제외", examples: [{ label: "홍시우", href: "/students" }, { label: "고은채", href: "/students" }, { label: "권태윤", href: "/students" }] },
  { key: "field:10_학생:5", total: 60, missing: 0, scope: "전체 학생 · 병합·검증용 제외", examples: [] },
  { key: "field:10_학생:14", total: 60, missing: 7, scope: "원본ID는 MakeEdu ID 기준", examples: [{ label: "나다온", href: "/students" }, { label: "류지안", href: "/students" }] },
  { key: "field:12_강좌:7", total: 10, missing: 1, scope: "현재 활성 강좌", examples: [{ label: "EiE 스피킹 2", href: "/classes" }] },
  { key: "field:11_직원:6", total: 10, missing: 2, scope: "현재 활성 직원", examples: [{ label: "윤태오", href: "/staff" }, { label: "송가람", href: "/staff" }] },
];

export function sampleKnowledgeRecords(today: string): KnowledgeRecordsData {
  const records = sampleRecords(today);
  return { records, history: withHistory(records), students: SAMPLE_STUDENTS, users: SAMPLE_STAFF, campaigns: CAMPAIGNS, today, actorId: NAMGUNG!, canReview: true, canWrite: true };
}

export function sampleAcademyKnowledge(input: { month: string; today: string; student?: string; teacher?: string }): AcademyKnowledgeData {
  const { month, today } = input, end = periodBounds(month).end, asOf = end < today ? end : today, from = addDays(asOf, -29);
  const student = SAMPLE_STUDENTS.some(p => p.id === input.student) ? input.student! : "";
  const teacher = SAMPLE_STAFF.some(p => p.id === input.teacher) ? input.teacher! : "";
  const records = sampleRecords(asOf), studio = studioRows(asOf);
  const ruleResults = student ? evaluateRules(observationFacts(records, student, from, asOf), from, asOf) : teacher ? evaluateRules({}, from, asOf, "teacher") : [];
  let graph = unifyGraphs(TENANT, `${asOf}T09:00:00.000Z`, [{ name: "management", graph: sourceGraph(asOf) }]);
  graph = addNativeGraph(graph, records, SAMPLE_STUDENTS, SAMPLE_STAFF, ruleResults, student || undefined);
  graph = applyStudioLinks(graph, studio.rows, asOf);
  // 예시 학생의 상세 주소는 없다 — 그 학생의 관찰·조치 목록으로 보낸다. 없는 화면 링크는 뺀다.
  graph = { ...graph, nodes: graph.nodes.map(n => ({ ...n, href: n.type === "Student" ? `/work-records/knowledge?student=${n.id.split(":").at(-1)}` : liveHref(n.href) ?? undefined })) };
  const status = [
    { name: "운영·재무", state: "연결", detail: `${month} 예시 청구·수강 / 회계는 마감 상태 별도` },
    { name: "홍보·행사", state: "연결", detail: "예시 캠페인 3개 · 90일 유입" },
    ...(student ? [{ name: "학생 통합", state: "연결", detail: "출결: 예시 · 상담: 예시 · 수업보고서: 예시" }] : []),
    ...(teacher ? [{ name: "강사 통합", state: "연결", detail: "담당 반: 예시 · 수업보고서: 예시" }] : []),
    { name: "조직·OKR", state: "조회 또는 권한 확인 필요", detail: "조직·OKR 화면은 아직 옮기지 않았습니다" },
    { name: "직접 입력", state: "연결", detail: `기준일까지 ${records.length}개 최신 기록 · 모든 변경 버전 보관` },
    { name: "Drive·Notion·Calendar·Slack·ClassNote", state: "상시 수집 미완료", detail: "이미 가져온 근거와 향후 자동 수집은 구분합니다." },
  ];
  return {
    month, today, asOf, from, graph, ruleResults, status, records, students: SAMPLE_STUDENTS, staff: SAMPLE_STAFF,
    activeProfiles: SAMPLE_STUDENTS, selectedStudent: student, selectedTeacher: teacher,
    metrics: sampleManagement(month).metrics, periodStart: periodBounds(month).start,
    studio: { ...studio, canWrite: true, error: "", audit: { fields: AUDIT, errors: [], asOf } },
  };
}
