import { buildGroupModel, type ExploreModel, type ExploreRow, type ExploreSector, type ExploreTarget } from "../../../model";
import type { NetAnalysis, NetFact, NetInput } from "../graph";

/**
 * 네트워크 보기 시험 표본(가상 값) — 단위 시험과 개발용 시험 화면(`/dev/explore-network`)이 함께 쓴다. 실제 학생·직원이 아니다.
 * 모양은 서버 조회(`server/student.ts` · `class.ts` · `teacher.ts`)가 채우는 모델과 같다(출결 줄의 `items` = 하루하루 기록 등).
 */

const cls = (id: string, label: string, detail: string, meta: string): ExploreTarget => ({ kind: "class", id, label, detail, meta, facts: [] });
export const C1 = cls("c1", "중2 수학 A반", "월·수·금 16:20~17:20 · 본원 302", "담임 박지훈");
export const C2 = cls("c2", "중2 수학 심화반", "토 10:00~12:00 · 본원 305", "담임 박지훈");
export const C3 = cls("c3", "EiE M2-3", "화·목 17:30~18:10 · 바른 602", "담임 최유진");
export const T1: ExploreTarget = { kind: "teacher", id: "t1", label: "박지훈", detail: "수학", meta: "담임" };
export const S1: ExploreTarget = { kind: "student", id: "s1", label: "김서연", detail: "경명여중2", meta: null };

const sector = (s: Partial<ExploreSector> & Pick<ExploreSector, "key" | "label" | "icon" | "tone">): ExploreSector => ({ summary: "", state: "ready", ...s });
const iso = (md: string) => `2026-${md.replace(".", "-")}`;

const DAYS = ["10.06", "10.08", "10.10", "10.11", "10.13", "10.15", "10.17", "10.18", "10.20", "10.21", "10.22", "10.24", "10.25", "10.27", "10.29", "10.30", "10.31", "11.01", "11.03"];
const att: ExploreRow[] = DAYS.map((d, i) => {
  const c = ["10.11", "10.18", "10.25", "11.01"].includes(d) ? C2.label : ["10.08", "10.15", "10.22", "10.29"].includes(d) ? C3.label : C1.label;
  const st = d === "10.21" ? "결석" : d === "10.13" || d === "10.27" ? "지각" : "출석";
  return { id: `att${i}`, title: c, date: iso(d), right: st, detail: st === "결석" ? "사전 통보 · 병원" : null };
});
const consults: ExploreRow[] = [
  ["cs1", "10.28", "10월 학습 점검 · 학부모 통화", "박지훈 · 학부모"],
  ["cs2", "10.14", "자습 집중 저하 관찰 공유", "최유진 · 학생"],
  ["cs3", "09.30", "9월 월말평가 결과 상담", "박지훈 · 학부모"],
  ["cs4", "09.12", "60일 점검 통화", "데스크 · 학부모"],
  ["cs5", "08.29", "첫 월말평가 안내", "박지훈 · 학부모"],
].map(([id, d, t, who]) => ({ id, title: t, date: iso(d), detail: who, body: `${t} — 상담 기록 본문(가상).` }));
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
  asOf: "2026-11-04",
  sectors: [
    sector({ key: "subject:math", label: "수학", icon: "graduationCap", tone: "blue", parts: [C1, C2].map((t) => ({ key: t.id, label: t.label, summary: "", target: t })), targets: [C1, C2] }),
    sector({ key: "subject:english", label: "영어", icon: "graduationCap", tone: "blue", parts: [{ key: "c3", label: C3.label, summary: "", target: C3 }], targets: [C3] }),
    sector({
      key: "attendance",
      label: "출결",
      icon: "calendarCheck",
      tone: "green",
      rows: [
        { id: "rate", title: "출석률", right: "95%", items: [{ id: "c:A", title: C1.label, right: "93%" }, { id: "c:E", title: C3.label, right: "100%" }] },
        { id: "total", title: "기록", right: `${att.length}건`, items: att },
        { id: "absent", title: "결석", right: "1건", items: att.filter((a) => a.right === "결석") },
      ],
    }),
    sector({ key: "grades", label: "성적", icon: "barChart", tone: "primary", rows: grades }),
    sector({ key: "progress", label: "진도", icon: "layers", tone: "purple", rows: progress }),
    sector({ key: "consultations", label: "상담", icon: "message", tone: "blue", rows: consults }),
    sector({ key: "memos", label: "특이사항", icon: "alertCircle", tone: "rose", rows: [{ id: "m1", title: "자습 시간 휴대폰 보관함 사용", date: iso("10.14"), detail: "최유진" }, { id: "m2", title: "셔틀 17:50 하원", date: iso("08.20"), detail: "데스크" }] }),
    sector({ key: "billing", label: "수납", icon: "wallet", tone: "green", rows: [{ id: "count", title: "총 청구", right: "5건" }, { id: "unpaid", title: "미납", right: "없음" }, { id: "latest", title: "최근 청구 기간", right: "2026-11" }] }),
    sector({ key: "timeline", label: "타임라인", icon: "clock", tone: "gold", rows: timeline }),
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
export const CLASS: ExploreModel = {
  center: { kind: "class", id: "c1", name: C1.label, subtitle: "수학", status: null, icon: "graduationCap", detailHref: "/classes/c1", detailLabel: "수업 상세 열기" },
  defaultSector: "students",
  asOf: "2026-11-04",
  sectors: [
    sector({ key: "students", label: "수강 원생", icon: "users", tone: "blue", targets: roster }),
    sector({ key: "teacher", label: "담임 강사", icon: "user", tone: "green", targets: [T1] }),
    sector({ key: "timetable", label: "시간표", icon: "calendar", tone: "primary", rows: ["월", "수", "금"].map((d, i) => ({ id: `tm${i}`, title: `${d}요일 16:20~17:20`, right: "본원 302" })) }),
    sector({ key: "room", label: "강의실", icon: "doorOpen", tone: "purple", rows: [{ id: "rm1", title: "본원 302", detail: "정원 14" }] }),
    sector({ key: "attendance", label: "출석부", icon: "clipboardCheck", tone: "rose", rows: [{ id: "ab11", title: "11월 출석부", detail: "기록 24칸" }, { id: "ab10", title: "10월 출석부", detail: "출석률 94%" }, { id: "ab09", title: "9월 출석부", detail: "출석률 96%" }] }),
    sector({ key: "sheet", label: "강사 시트", icon: "spreadsheet", tone: "green", rows: [{ id: "sh1", title: "수학 강사 시트", detail: "학생 × 수업일" }] }),
  ],
};

export const TEACHER: ExploreModel = {
  center: { kind: "teacher", id: "t1", name: "박지훈", subtitle: "수학", status: null, icon: "user", detailHref: "/staff/t1", detailLabel: "직원 상세 열기" },
  defaultSector: "classes",
  asOf: "2026-11-04",
  sectors: [
    sector({ key: "classes", label: "담당 수업", icon: "graduationCap", tone: "blue", targets: [C1, C2] }),
    sector({ key: "timetable", label: "수업 시간표", icon: "calendar", tone: "green", rows: [{ id: "tt1", title: "월·수·금 중2 수학 A반" }, { id: "tt2", title: "토 중2 수학 심화반" }] }),
    sector({ key: "students", label: "담당 원생", icon: "users", tone: "primary", targets: roster.slice(0, 8) }),
    sector({ key: "reports", label: "수업보고서", icon: "report", tone: "rose", rows: [{ id: "r1", title: "작성 14 · 발송 12", detail: "최근 7일" }] }),
  ],
};

/** 시험 화면의 중심들 — 열쇠 = 판의 가운데 점 id(`kind:id[:영역]`). */
export const CENTERS: Record<string, NetInput> = {
  "student:s1": { model: STUDENT, analyses: ANALYSES, facts: FACTS },
  "class:c1": { model: CLASS },
  "teacher:t1": { model: TEACHER },
  "student:s1:attendance": { model: buildGroupModel(STUDENT, "attendance")! },
  "student:s1:consultations": { model: buildGroupModel(STUDENT, "consultations")! },
};
