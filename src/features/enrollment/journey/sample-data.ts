import { addDays } from "@/lib/date-kst";
import { summarizeJourney, type JourneyConsultation, type JourneyDocument, type JourneyRecord } from "./model";

/**
 * 방문·등록 기록 시안 — aywa-next(375d27df4)의 `enrollment_journey_records`·`enrollment_journey_revisions`가 이 DB에 없다.
 * 🔴 이름·학교·연락처·날짜는 전부 지어낸 값이다(실제 상담과 연결되지 않는다). 저장 RPC도 없으므로 화면은 저장하지 않는다.
 */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const STAFF = [
  { id: uuid(901), display_name: "한서연", status: "active", system_role: "manager" },
  { id: uuid(902), display_name: "오지훈", status: "active", system_role: "admin" },
  { id: uuid(903), display_name: "문채원", status: "active", system_role: "counselor" },
  { id: uuid(904), display_name: "배준호", status: "inactive", system_role: "teacher" },
];

type Seed = { name: string; school: string; grade: string; daysAgo: number; path: string | null; outcome: string; counselor: string | null; phone: string | null; student?: number };
const SEEDS: Seed[] = [
  { name: "김하늘", school: "가온중", grade: "중1", daysAgo: 6, path: "지인 소개", outcome: "enrolled", counselor: "한서연", phone: "010-2101-0001", student: 1 },
  { name: "이도윤", school: "누리초", grade: "초6", daysAgo: 9, path: "블로그", outcome: "pending", counselor: "문채원", phone: "010-2101-0002" },
  { name: "박서준", school: "다솜중", grade: "중2", daysAgo: 14, path: "설명회", outcome: "enrolled", counselor: "오지훈", phone: "010-2101-0003", student: 3 },
  { name: "최유나", school: "가온중", grade: "중3", daysAgo: 21, path: null, outcome: "pending", counselor: null, phone: "010-2101-0004" },
  { name: "정민재", school: "라온고", grade: "고1", daysAgo: 27, path: "간판", outcome: "not_enrolled", counselor: "한서연", phone: "010-2101-0005" },
  { name: "윤소율", school: "누리초", grade: "초5", daysAgo: 33, path: "지인 소개", outcome: "enrolled", counselor: "문채원", phone: "010-2101-0006", student: 6 },
  { name: "강지후", school: "다솜중", grade: "중1", daysAgo: 41, path: "블로그", outcome: "pending", counselor: "오지훈", phone: null },
  { name: "임하린", school: "라온고", grade: "고2", daysAgo: 52, path: "설명회", outcome: "enrolled", counselor: "한서연", phone: "010-2101-0008" },
  { name: "송예준", school: "가온중", grade: "중2", daysAgo: 63, path: "전단", outcome: "not_enrolled", counselor: null, phone: "010-2101-0009" },
  { name: "조은서", school: "누리초", grade: "초6", daysAgo: 75, path: "지인 소개", outcome: "enrolled", counselor: "문채원", phone: "010-2101-0010", student: 10 },
];

function consultations(today: string): JourneyConsultation[] {
  return SEEDS.map((s, i) => {
    const day = addDays(today, -s.daysAgo);
    return {
      id: uuid(i + 1), prospect_name: s.name, prospect_school: s.school, prospect_grade: s.grade, parent_phone: s.phone,
      student_id: s.student ? uuid(500 + s.student) : null, consulted_at: `${day}T01:00:00Z`, received_date: day,
      consultation_date: day, consultation_path: s.path, outcome: s.outcome, counselor: s.counselor,
      consultant_id: s.counselor ? STAFF.find((p) => p.display_name === s.counselor)?.id ?? null : null, legacy_source: null,
    };
  });
}

function doc(today: string, patch: Partial<JourneyDocument> & Pick<JourneyDocument, "kind" | "status">): JourneyDocument {
  return { purpose: "new", scheduledOn: null, happenedOn: today, ownerId: STAFF[0].id, evidence: "", sourceUrl: "", nextAction: "", nextDue: null, nextDoneOn: null, ...patch };
}

function records(today: string): JourneyRecord[] {
  const d = (n: number) => addDays(today, -n);
  const rows: [number, number, JourneyDocument][] = [
    [1, 1, doc(today, { kind: "call", status: "connected", happenedOn: d(6), evidence: "어머님과 통화 · 중1 수학 선행 희망, 토요일 방문 가능", ownerId: STAFF[0].id })],
    [2, 1, doc(today, { kind: "visit", status: "completed", scheduledOn: d(4), happenedOn: d(4), evidence: "학생·어머님 방문 · 진단 평가 후 반 안내", ownerId: STAFF[0].id })],
    [3, 1, doc(today, { kind: "registration", status: "confirmed", happenedOn: d(2), evidence: "등록 확정 문자 회신 확인", ownerId: STAFF[0].id })],
    [4, 2, doc(today, { kind: "call", status: "unanswered", happenedOn: d(8), evidence: "두 차례 통화 연결 안 됨 · 문자 남김", ownerId: STAFF[2].id, nextAction: "저녁 시간 재연락", nextDue: d(5) })],
    [5, 2, doc(today, { kind: "visit", status: "scheduled", scheduledOn: addDays(today, 3), happenedOn: null, evidence: "다음 주 수요일 오후 4시 방문 예약", ownerId: STAFF[2].id })],
    [6, 3, doc(today, { kind: "visit", status: "completed", scheduledOn: d(12), happenedOn: d(12), evidence: "설명회 후 개별 방문 · 영어 레벨테스트 진행", ownerId: STAFF[1].id })],
    [7, 3, doc(today, { kind: "registration", status: "confirmed", happenedOn: d(10), evidence: "수강 등록서 작성 확인", ownerId: STAFF[1].id })],
    [8, 4, doc(today, { kind: "visit", status: "scheduled", scheduledOn: d(15), happenedOn: null, evidence: "방문 예약 · 결과 확인 전", ownerId: STAFF[0].id, nextAction: "방문 여부 확인 전화", nextDue: d(13) })],
    [9, 5, doc(today, { kind: "visit", status: "no_show", scheduledOn: d(24), happenedOn: d(24), evidence: "예약 시간 미방문 · 연락 후 일정 취소 의사 확인", ownerId: STAFF[0].id })],
    [10, 6, doc(today, { kind: "visit", status: "completed", scheduledOn: d(30), happenedOn: d(30), evidence: "형제 재원 중 · 상담실 방문", ownerId: STAFF[2].id })],
    [11, 6, doc(today, { kind: "registration", status: "confirmed", happenedOn: d(28), evidence: "첫 수업 일정 안내 후 확정", ownerId: STAFF[2].id, nextAction: "첫 주 적응 확인 전화", nextDue: d(20), nextDoneOn: d(19) })],
    [12, 8, doc(today, { kind: "visit", status: "completed", scheduledOn: d(49), happenedOn: d(49), evidence: "고2 수학 내신 상담 방문", ownerId: STAFF[0].id, purpose: "returning" })],
    [13, 8, doc(today, { kind: "registration", status: "confirmed", happenedOn: d(46), evidence: "재등록 확정 · 이전 반 담임 인계", ownerId: STAFF[0].id, purpose: "returning" })],
    [14, 9, doc(today, { kind: "call", status: "connected", happenedOn: d(62), evidence: "전단 보고 문의 · 시간표만 안내", ownerId: STAFF[1].id })],
    [15, 10, doc(today, { kind: "visit", status: "cancelled", scheduledOn: d(72), happenedOn: d(73), evidence: "가족 일정으로 방문 취소 확인", ownerId: STAFF[2].id })],
  ];
  return rows.map(([n, c, document]) => ({
    id: uuid(100 + n), consultation_id: uuid(c), version: n % 3 === 0 ? 2 : 1, document, voided: false,
    updated_at: `${document.happenedOn ?? document.scheduledOn ?? today}T03:00:00Z`, actor_id: document.ownerId,
  }));
}

export type JourneyRevision = { version: number; document: JourneyDocument; voided: boolean; reason: string; recorded_at: string; actor_id: string };

/** 시안의 변경 이력 — 같은 문서를 v1(최초)·현재 버전으로 보여준다. */
export function sampleJourneyHistory(record: JourneyRecord): JourneyRevision[] {
  const current = { version: record.version, document: record.document, voided: record.voided, reason: record.version > 1 ? "실제 방문일 오기 수정" : "", recorded_at: record.updated_at, actor_id: record.actor_id };
  return record.version > 1 ? [current, { ...current, version: 1, reason: "", document: { ...record.document, status: record.document.kind === "visit" ? "scheduled" : record.document.status, happenedOn: record.document.kind === "visit" ? null : record.document.happenedOn } }] : [current];
}

export function sampleJourney(today: string, requestedYear?: number) {
  const thisYear = Number(today.slice(0, 4));
  const year = requestedYear && requestedYear >= 2021 && requestedYear <= thisYear ? requestedYear : thisYear;
  const rows = consultations(today), all = records(today);
  const through = year === thisYear ? today : `${year}-12-31`;
  const summary = summarizeJourney(rows, all, `${year}-01-01`, through);
  const choices = rows.map((r) => ({ id: r.id, name: r.prospect_name, label: `${r.prospect_name} · ${r.prospect_school ?? "학교 미기재"} ${r.prospect_grade ?? ""} · ${r.received_date}`, studentId: r.student_id ?? null, legacyDate: r.consultation_date, path: r.consultation_path }));
  return { today, year, through, summary, records: all, choices, staff: STAFF, currentUser: STAFF[0].id, canWrite: true, consultationId: null as string | null, sample: true as const };
}
export type JourneyData = ReturnType<typeof sampleJourney>;
