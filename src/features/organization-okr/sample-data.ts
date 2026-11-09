import { okrGraph, type KR, type OkrDocument, type OkrRecord } from "./model";

/**
 * 조직·OKR 시안의 예시 값 — 🔴 DB를 읽지 않는다(organization_okr 표가 이 DB에 없다).
 * 이름·수치는 지어낸 값이다. 원장(김하늘) 계정으로 본다고 가정한다(작성·피드백 권한 켬).
 */
const TODAY = "2026-11-09";
const id = (group: number, n: number) => `00000000-0000-4000-9${String(group).padStart(3, "0")}-${String(n).padStart(12, "0")}`;
const STAFF = { kim: id(1, 1), lee: id(1, 2), park: id(1, 3), choi: id(1, 4), jung: id(1, 5) };
const NAMES: Record<string, string> = { [STAFF.kim]: "김하늘", [STAFF.lee]: "이도윤", [STAFF.park]: "박서준", [STAFF.choi]: "최유나", [STAFF.jung]: "정민호" };

function kr(n: number, title: string, p: Partial<KR>): KR {
  return { id: id(3, n), title, definition: "분자 ÷ 분모 × 100", population: "해당 기간 담당 대상", guardrail: "수치만 보지 않고 학생·학부모 반응을 함께 확인", baseline: null, target: null, actual: null, direction: "higher", unit: "%", source: "manual", measuredOn: null, evidence: "", refs: [], ...p };
}
const checkin = (date: string | null, confidence: OkrDocument["checkin"]["confidence"], result = "", next = "", help = "", learning = ""): OkrDocument["checkin"] => ({ date, confidence, result, learning, help, next });

const ROWS: OkrRecord[] = [
  { id: id(2, 1), owner_id: STAFF.kim, version: 4, updated_at: "2026-11-03T09:00:00.000Z", review: null, document: {
    scope: "organization", ownerId: STAFF.kim, parentId: null, team: "", title: "근거가 확인되는 신규 등록과 정착을 함께 만든다", why: "등록 수만 늘리면 90일 안에 그만두는 학생이 늘어난다. 유입과 정착을 같은 목표로 본다.", from: "2026-09-01", through: "2026-12-31", state: "active",
    krs: [kr(1, "유입 경로가 확인된 신규 등록 인원", { unit: "명", baseline: 18, target: 30, actual: 21, measuredOn: "2026-11-03", evidence: "신규 콜&상담 · 9~10월 등록 21명(경로 확인)", definition: "유입 경로를 확인한 신규 등록 인원", population: "9~12월 신규 등록" }),
      kr(2, "신입생 90일 유지율", { baseline: 78, target: 88, actual: 83, measuredOn: "2026-11-03", evidence: "신규생 관리 탭 · 6~8월 등록 24명 중 20명 재원", definition: "등록 후 90일 시점 재원 인원 ÷ 해당 기간 등록 인원 × 100" })],
    tasks: [], checkin: checkin("2026-11-03", "ontrack", "10월 예비 중1 설명회 뒤 상담 9건", "기말 설명회 준비 · 신입생 30일 점검 독려") } },
  { id: id(2, 2), owner_id: STAFF.park, version: 3, updated_at: "2026-11-05T09:00:00.000Z", review: { note: "30일 점검 누락 학생 명단을 먼저 공유해 주세요.", verdict: "revise", reviewerId: STAFF.kim, at: "2026-11-06T02:00:00.000Z", version: 3 }, document: {
    scope: "team", ownerId: STAFF.park, parentId: id(2, 1), team: "상담팀", title: "신입생의 요구와 약속을 놓치지 않는다", why: "등록 직후 한 달이 정착을 가른다.", from: "2026-09-01", through: "2026-12-31", state: "active",
    krs: [kr(3, "30·60·90일 점검의 기한 내 완료율", { baseline: 62, target: 90, actual: 74, measuredOn: "2026-11-05", evidence: "신규생 관리 체크리스트 · 기한 도래 46건 중 34건 완료" }),
      kr(4, "점검 과제 완료율", { source: "tasks", baseline: 0, target: 100, actual: 50, measuredOn: "2026-11-05", evidence: "완료 2 / 전체 4 과제 · 저장 시점", definition: "완료 결과가 기록된 과제 ÷ 이 KR의 전체 과제 × 100", population: "이 핵심결과에 연결한 실행 과제" })],
    tasks: [{ id: id(4, 1), krId: id(3, 4), title: "9월 등록생 30일 점검 통화", due: "2026-10-15", status: "done", result: "12명 통화 완료, 2명 반 이동 요청" },
      { id: id(4, 2), krId: id(3, 4), title: "점검 결과를 담임에게 공유", due: "2026-10-20", status: "done", result: "담임 4명에게 메모 전달" },
      { id: id(4, 3), krId: id(3, 4), title: "10월 등록생 30일 점검", due: "2026-11-07", status: "doing", result: "" },
      { id: id(4, 4), krId: id(3, 4), title: "60일 점검 질문지 정리", due: "2026-11-20", status: "todo", result: "" }],
    checkin: checkin("2026-10-28", "risk", "10월 등록생 점검이 밀림", "이번 주 안에 10월 등록생 점검 마무리", "데스크 통화 지원 1시간") } },
  { id: id(2, 3), owner_id: STAFF.choi, version: 5, updated_at: "2026-11-04T09:00:00.000Z", review: { note: "약속 이행률 근거가 분명해서 좋습니다.", verdict: "acknowledged", reviewerId: STAFF.kim, at: "2026-11-04T10:00:00.000Z", version: 5 }, document: {
    scope: "individual", ownerId: STAFF.choi, parentId: id(2, 1), team: "", title: "담당 학생이 약속한 학습 목표를 달성하도록 돕는다", why: "중2 학생들의 숙제 이행이 시험 결과로 이어지게.", from: "2026-09-01", through: "2026-12-31", state: "active",
    krs: [kr(5, "상담에서 합의한 진도 약속의 기한 내 이행률", { baseline: 55, target: 80, actual: 71, measuredOn: "2026-11-04", evidence: "원생상담 기록 · 만기 약속 28건 중 20건 이행" }),
      kr(6, "담당자가 작성한 수업보고서 수", { source: "lessons", unit: "건", baseline: 0, target: 60, actual: 3, measuredOn: "2026-11-04", evidence: "2026-09-01~2026-11-04 · 담당자 ID로 확인한 3건 · 저장 시점", definition: "목표 기간 안에 담당자 ID로 확인한 원본 기록 수", population: "목표 담당자가 직접 기록한 해당 기간 자료",
        refs: [1, 2, 3].map((n) => ({ kind: "lessons" as const, id: id(5, n), version: null, date: `2026-10-0${n}`, label: `2026-10-0${n} 담당자 작성 수업보고서`, href: "/lesson-reports" })) })],
    tasks: [{ id: id(4, 5), krId: id(3, 5), title: "약속 이행 체크를 수업 시작 5분에", due: "2026-12-15", status: "doing", result: "" }],
    checkin: checkin("2026-11-04", "ontrack", "중간고사 뒤 숙제 이행률 회복", "기말 범위 진도 약속 다시 합의") } },
  { id: id(2, 4), owner_id: STAFF.lee, version: 1, updated_at: "2026-11-01T09:00:00.000Z", review: null, document: {
    scope: "individual", ownerId: STAFF.lee, parentId: null, team: "", title: "담당 업무의 누락과 재작업을 줄인다", why: "", from: "2026-11-01", through: "2026-12-31", state: "draft",
    krs: [kr(7, "필수 업무의 기한 내 정확한 처리율", {})], tasks: [], checkin: checkin(null, "ontrack") } },
  { id: id(2, 5), owner_id: STAFF.jung, version: 6, updated_at: "2026-08-31T09:00:00.000Z", review: null, document: {
    scope: "individual", ownerId: STAFF.jung, parentId: null, team: "", title: "여름방학 특강 수강생의 정착을 돕는다", why: "특강 뒤 정규반 전환이 낮았다.", from: "2026-07-01", through: "2026-08-31", state: "closed",
    krs: [kr(8, "특강 수강생의 정규반 전환율", { baseline: 20, target: 35, actual: 31, measuredOn: "2026-08-31", evidence: "특강 26명 중 8명 정규반 등록" })],
    tasks: [], checkin: checkin("2026-08-31", "ontrack", "8명 전환", "", "", "마지막 주 상담을 특강 2주차로 당기면 전환이 더 빨랐을 것") } },
];

/** 조직·OKR 화면이 받던 모양 그대로(server.ts의 loadOkrWorkspace 반환값). */
export function sampleOkrWorkspace() {
  const rows = ROWS, names = NAMES;
  const shared = rows.filter((r) => r.document.state === "active" && r.document.scope !== "individual").map((r) => ({ id: r.id, ownerId: r.owner_id, title: r.document.title, scope: r.document.scope, from: r.document.from, through: r.document.through, team: r.document.team, parentId: r.document.parentId, krs: r.document.krs.map((k) => ({ title: k.title, actual: k.actual, target: k.target, unit: k.unit, measuredOn: k.measuredOn })) }));
  const graph = okrGraph(rows.filter((r) => r.document.state !== "archived"), names);
  return { rows, shared, names, actorId: STAFF.kim, writable: true, manager: true, today: TODAY, graph };
}
