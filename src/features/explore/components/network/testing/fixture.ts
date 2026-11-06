import { buildGroupModel, type ExploreModel, type ExploreRow, type ExploreSector, type ExploreTarget } from "../../../model";
import type { NetAnalysis, NetFact, NetInput } from "../graph";
import { AS_OF, CONSULTS, classAttendanceRows, studentAttendance, studentAttendanceRows } from "./fixture-records";

/**
 * 네트워크 보기 시험 표본(가상 값) — 단위 시험과 개발용 시험 화면(`/dev/explore-network`)이 함께 쓴다. 실제 학생·직원이 아니다.
 * 모양은 서버 조회(`server/student.ts` · `class.ts` · `teacher.ts`)가 채우는 모델과 같다(출결 줄의 `items` = 하루하루 기록 등).
 */

// 사실 칩 = 서버(`teacher.ts` · `room.ts`)처럼 반마다 요일·원생 수 — 영역 중심에서 줄 id `f0`·`f1`이 반마다 겹친다.
const cls = (id: string, label: string, detail: string, meta: string, facts: string[]): ExploreTarget => ({ kind: "class", id, label, detail, meta, facts });
export const C1 = cls("c1", "중2 수학 A반", "월·수·금 16:20~17:20 · 본원 302", "담임 박지훈", ["월·수·금 · 주 3회", "원생 12명"]);
export const C2 = cls("c2", "중2 수학 심화반", "토 10:00~12:00 · 본원 305", "담임 박지훈", ["토 · 주 1회", "원생 6명"]);
export const C3 = cls("c3", "EiE M2-3", "화·목 17:30~18:10 · 바른 602", "담임 최유진", ["화·목 · 주 2회", "원생 8명"]);
/** 원생 '수업' 작은 조각의 반 요약 줄 — `server/student.ts` `rowsOf`와 같은 줄 id(반마다 같은 id). */
const classRows = (subject: string, schedule: string, room: string, period: string): ExploreRow[] => [
  { id: "subject", title: "과목 · 담임", right: subject },
  { id: "schedule", title: "요일 · 교시", right: schedule },
  { id: "room", title: "강의실", right: room },
  { id: "period", title: "수강 기간", right: period },
];
export const T1: ExploreTarget = { kind: "teacher", id: "t1", label: "박지훈", detail: "수학", meta: "담임" };
export const S1: ExploreTarget = { kind: "student", id: "s1", label: "김서연", detail: "경명여중2", meta: null };

const sector = (s: Partial<ExploreSector> & Pick<ExploreSector, "key" | "label" | "icon" | "tone">): ExploreSector => ({ summary: "", state: "ready", ...s });
const iso = (md: string) => `2026-${md.replace(".", "-")}`;

const grades: ExploreRow[] = [
  ["g1", "10.30", "수학 월말평가", "88점"],
  ["g2", "10.15", "수학 2학기 중간", "92점"],
  ["g3", "09.26", "수학 월말평가", "81점"],
  ["g4", "08.29", "수학 월말평가", "79점"],
].map(([id, d, t, r]) => ({ id, title: t, date: iso(d), right: r, detail: C1.label }));
const progress: ExploreRow[] = ["유리수의 계산 복습", "일차함수 그래프 ②", "일차함수 그래프 ①", "일차함수의 뜻", "연립방정식 활용 ②", "연립방정식 활용 ①"].map((t, i) => ({
  id: `rp${i}`,
  title: t,
  date: iso(["11.03", "10.31", "10.29", "10.27", "10.24", "10.22"][i]),
  detail: "수학 · 박지훈",
}));
const timeline: ExploreRow[] = [
  ["tl0", "11.03", "수업보고서 발송 · 중2 수학 A반"],
  ["tl1", "10.30", "10월 월말평가 88점"],
  ["tl2", "10.28", "학부모 통화 · 10월 학습 점검"],
  ["tl3", "10.21", "결석 · 병원"],
  ["tl4", "10.15", "2학기 중간 92점"],
  ["tl5", "10.01", "10월 수강료 납부"],
].map(([id, d, t]) => ({ id, title: t, date: iso(d) }));

export const STUDENT: ExploreModel = {
  center: { kind: "student", id: "s1", name: "김서연", subtitle: "경명여중2", status: null, icon: "user", detailHref: "/students/s1", detailLabel: "원생 상세 열기" },
  defaultSector: "subject:math",
  asOf: AS_OF,
  sectors: [
    sector({ key: "subject:math", label: "수학", summary: "2개 반", icon: "graduationCap", tone: "blue", parts: [
      { key: C1.id, label: C1.label, summary: "", target: C1, rows: classRows("수학 · 박지훈", "월·수·금 16:20~17:20", "본원 302", "2025-12-01 ~ 현재") },
      { key: C2.id, label: C2.label, summary: "", target: C2, rows: classRows("수학 · 박지훈", "토 10:00~12:00", "본원 305", "2026-03-02 ~ 현재") },
    ], targets: [C1, C2] }),
    sector({ key: "subject:english", label: "영어", summary: "EiE M2-3", icon: "graduationCap", tone: "blue", parts: [{ key: "c3", label: C3.label, summary: "", target: C3 }], targets: [C3] }),
    sector({
      key: "attendance",
      label: "출결",
      summary: "최근 30일 93%",
      icon: "calendarCheck",
      tone: "green",
      rows: studentAttendanceRows(studentAttendance({ a: C1.label, e: C3.label, s: C2.label })),
    }),
    sector({ key: "grades", label: "성적", summary: "월말평가 88점", icon: "barChart", tone: "primary", rows: grades }),
    sector({ key: "progress", label: "진도", summary: "유리수의 계산 복습", icon: "layers", tone: "purple", rows: progress }),
    sector({ key: "consultations", label: "상담", summary: "최근 상담 10월 28일", icon: "message", tone: "blue", rows: CONSULTS }),
    sector({ key: "memos", label: "특이사항", summary: "메모 2건", icon: "alertCircle", tone: "rose", rows: [{ id: "m1", title: "자습 시간 휴대폰 보관함 사용", date: iso("10.14"), detail: "최유진" }, { id: "m2", title: "셔틀 17:50 하원", date: iso("08.20"), detail: "데스크" }] }),
    sector({ key: "billing", label: "수납", summary: "납부 완료", icon: "wallet", tone: "green", rows: [{ id: "count", title: "총 청구", right: "5건" }, { id: "unpaid", title: "미납", right: "없음" }, { id: "latest", title: "최근 청구 기간", right: "2026-11" }] }),
    sector({ key: "timeline", label: "타임라인", summary: "11월 3일 수업보고서 발송", icon: "clock", tone: "gold", rows: timeline }),
  ],
};

export const ANALYSES: NetAnalysis[] = [
  { id: "flow-consult", title: "흐름 분석 · 상담", detail: "AI · 저장된 결과", evidence: ["cs1", "cs2", "cs3", "consultations"], kind: "ai" },
  { id: "flow-timeline", title: "흐름 분석 · 타임라인", detail: "AI · 저장된 결과", evidence: ["tl1", "tl3", "att9", "g1"], kind: "ai" },
];
export const FACTS: NetFact[] = [
  { id: "of1", title: "형제 · 김서준(초5)", detail: "보호자 휴대폰 같음 · 자동 판정" },
  { id: "of2", title: "보호자 선호 연락 · 전화", detail: "상담 기록에서" },
  { id: "of3", title: "셔틀 하원 17:50", detail: "데스크 메모 08.20" },
  { id: "of4", title: "긍정 신호 · 10월 2건", detail: "밤 판정" },
];

const roster: ExploreTarget[] = [S1, ...["이도윤", "박하은", "최지호", "정서윤", "강민준", "윤채원", "임지안", "한유진", "오시우", "서다인", "신예준"].map((n, i) => ({ kind: "student" as const, id: `s${i + 2}`, label: n, detail: "경명여중2" }))];
const R1: ExploreTarget = { kind: "room", id: "r1", label: "본원 302", meta: "3칸" };
export const CLASS: ExploreModel = {
  center: { kind: "class", id: "c1", name: C1.label, subtitle: "수학", status: null, icon: "graduationCap", detailHref: "/classes/c1", detailLabel: "수업 상세 열기" },
  defaultSector: "students",
  asOf: AS_OF,
  sectors: [
    sector({ key: "students", label: "수강 원생", icon: "users", tone: "blue", targets: roster }),
    sector({ key: "teacher", label: "담임 강사", icon: "user", tone: "green", targets: [T1] }),
    // 서버 모양(`server/class.ts`): 시간표 = 요일 묶음 줄 · 강의실 = 강의실 대상 + 교시마다 방 줄 · 출석부 = 30일 학생 기록 5줄.
    sector({ key: "timetable", label: "시간표", icon: "calendar", tone: "primary", rows: [{ id: "d0", title: "월·수·금", right: "16:20~17:20" }] }),
    sector({ key: "room", label: "강의실", icon: "doorOpen", tone: "purple", targets: [R1], rows: ["월", "수", "금"].map((d, i) => ({ id: `slot${i}`, title: `${d} 16:20~17:20`, right: R1.label })) }),
    sector({ key: "attendance", label: "출석부", icon: "clipboardCheck", tone: "rose", rows: classAttendanceRows(roster.map((t) => t.label)) }),
    sector({ key: "sheet", label: "강사 시트", icon: "spreadsheet", tone: "green", summary: "수학 수업 기록", links: [{ href: "/mcs/c1/month", label: "수학 강사 시트 열기" }] }),
  ],
};

export const TEACHER: ExploreModel = {
  center: { kind: "teacher", id: "t1", name: "박지훈", subtitle: "수학", status: null, icon: "user", detailHref: "/staff/t1", detailLabel: "직원 상세 열기" },
  defaultSector: "classes",
  asOf: AS_OF,
  sectors: [
    sector({ key: "classes", label: "담당 수업", icon: "graduationCap", tone: "blue", targets: [C1, C2] }),
    sector({ key: "timetable", label: "수업 시간표", icon: "calendar", tone: "green", rows: [{ id: "c1", title: C1.label, right: "월·수·금 16:20~17:20" }, { id: "c2", title: C2.label, right: "토 10:00~12:00" }] }),
    sector({ key: "students", label: "담당 원생", icon: "users", tone: "primary", targets: roster.slice(0, 8) }),
    // 서버 모양: 작성자 기준 최근 5건 · 줄 제목 = 학생 이름 · 날짜만(상세 없음).
    sector({ key: "reports", label: "수업보고서", icon: "report", tone: "rose", summary: "최근 7일 4건", rows: ["2026-11-04", "2026-11-04", "2026-11-02", "2026-10-30", "2026-10-28"].map((date, i) => ({ id: `rp-t${i}`, title: roster[i].label, date })) }),
  ],
};

export const ROOM: ExploreModel = {
  center: { kind: "room", id: "r1", name: R1.label, subtitle: "정원 14석", status: null, icon: "doorOpen", detailHref: null, detailLabel: "강의실 관리 열기" },
  defaultSector: "classes",
  asOf: AS_OF,
  sectors: [
    sector({ key: "classes", label: "수업", icon: "graduationCap", tone: "blue", targets: [C1, C2] }),
    sector({ key: "teachers", label: "강사", icon: "user", tone: "green", targets: [T1] }),
    sector({ key: "timetable", label: "시간표", icon: "calendar", tone: "primary", rows: [...["월", "수", "금"].map((d, i) => ({ id: `slot${i}`, title: `${d} 16:20~17:20`, detail: C1.label, right: T1.label })), { id: "slot9", title: "토 10:00~12:00", detail: C2.label, right: T1.label }] }),
    sector({ key: "info", label: "강의실 정보", icon: "settings", tone: "purple", rows: [{ id: "name", title: R1.label, detail: "이름" }, { id: "capacity", title: "14석", detail: "정원" }] }),
  ],
};

/** 시험 화면의 중심들 — 열쇠 = 판의 가운데 점 id(`kind:id[:영역]`). */
export const CENTERS: Record<string, NetInput> = {
  "student:s1": { model: STUDENT, analyses: ANALYSES, facts: FACTS },
  "class:c1": { model: CLASS },
  "teacher:t1": { model: TEACHER },
  "room:r1": { model: ROOM },
  "room:r1:classes": { model: buildGroupModel(ROOM, "classes")! },
  "teacher:t1:classes": { model: buildGroupModel(TEACHER, "classes")! },
  "class:c1:attendance": { model: buildGroupModel(CLASS, "attendance")! },
  "class:c1:students": { model: buildGroupModel(CLASS, "students")! },
  "student:s1:attendance": { model: buildGroupModel(STUDENT, "attendance")! },
  "student:s1:consultations": { model: buildGroupModel(STUDENT, "consultations")! },
  "student:s1:subject:math": { model: buildGroupModel(STUDENT, "subject:math")! },
};
