/**
 * 공개 랜딩 작업 공간의 **예시 학원**(원생 12명·반 6개) — 실제 학원 데이터가 아니다(로그인 전 화면).
 * 숫자가 창끼리 서로 맞도록 한 벌로 둔다: 출결 입력·시간표 출결 표시·운영실 KPI·수납률이 전부 이 값에서 계산된다.
 * 오늘 = 2026-09-22(화), 운영 브리핑 = 매일 07:00(실제 크론 시각).
 */
export type Subj = "math" | "eng";
export type Att = "p" | "a" | "l" | "";
export type AttMap = Record<string, Record<number, Record<string, Att>>>;

export const DAYS = ["월", "화", "수", "목", "금"] as const;
export const DATES = ["9/21", "9/22", "9/23", "9/24", "9/25"] as const;
export const TODAY = 1;
/** 이번 주 휴일(요일 칸 → 이름) — 2026 추석 연휴 9/24~26. 시간표·강사 시트가 같은 값을 본다. */
export const HOLIDAYS: Record<number, string> = { 3: "추석", 4: "추석" };
export const PERIODS: [string, string][] = [["14:30", "16:20"], ["16:20", "18:10"], ["18:10", "20:00"], ["20:10", "22:00"]];

export const STUDENTS: Record<string, { sg: string; subj: Subj[]; tag?: string }> = {
  김하늘: { sg: "예시중2", subj: ["math", "eng"] },
  이준서: { sg: "예시중2", subj: ["math"] },
  최도윤: { sg: "예시중2", subj: ["math", "eng"] },
  서지안: { sg: "예시중2", subj: ["math"] },
  박서윤: { sg: "예시중1", subj: ["math", "eng"] },
  강민재: { sg: "예시중1", subj: ["math", "eng"] },
  신예린: { sg: "예시중1", subj: ["math"] },
  윤서아: { sg: "예시중3", subj: ["math"] },
  오민준: { sg: "예시중3", subj: ["math"] },
  한지우: { sg: "예시고1", subj: ["math"] },
  정하린: { sg: "예시초6", subj: ["eng"], tag: "신규" },
  노은채: { sg: "예시초6", subj: ["eng"] },
};

export type ClassInfo = { name: string; subj: Subj; t: string; room: string; slots: [number, number][]; roster: string[] };
export const CLASSES: Record<string, ClassInfo> = {
  e6: { name: "초6 영어", subj: "eng", t: "이선생", room: "201호", slots: [[1, 0], [3, 0]], roster: ["정하린", "노은채"] },
  m2a: { name: "중2 A반", subj: "math", t: "김선생", room: "302호", slots: [[1, 1], [4, 1]], roster: ["김하늘", "이준서", "최도윤", "서지안"] },
  m1: { name: "중1 수학", subj: "math", t: "박선생", room: "301호", slots: [[0, 1], [2, 1]], roster: ["박서윤", "강민재", "신예린"] },
  m3: { name: "중3 수학", subj: "math", t: "김선생", room: "302호", slots: [[1, 2], [3, 2]], roster: ["윤서아", "오민준"] },
  eB: { name: "중등 영어 B", subj: "eng", t: "이선생", room: "201호", slots: [[0, 2], [2, 2], [4, 2]], roster: ["김하늘", "최도윤", "박서윤", "강민재"] },
  h1: { name: "고1 수학", subj: "math", t: "최선생", room: "303호", slots: [[0, 3], [3, 3]], roster: ["한지우"] },
};

export const SUBJ_LABEL: Record<Subj, string> = { math: "수학", eng: "영어" };
export const FEE: Record<Subj, number> = { math: 420000, eng: 380000 };
export const ST_LABEL: Record<Att, string> = { p: "출석", a: "결석", l: "지각", "": "—" };
export const PAST: Record<string, Att[]> = {
  김하늘: ["p", "a", "p", "a"], 이준서: ["p", "p", "p", "p"], 최도윤: ["p", "p", "l", "p"], 서지안: ["p", "l", "p", "p"],
  박서윤: ["p", "p", "p", "p"], 강민재: ["p", "l", "p", "p"], 신예린: ["p", "p", "p", "p"], 윤서아: ["p", "p", "p", "l"],
  오민준: ["p", "p", "p", "p"], 한지우: ["p", "p", "a", "a"], 정하린: ["p", "p", "p", "p"], 노은채: ["p", "p", "l", "p"],
};

export type KanCard = { n: string; g: string; s: string; m?: string };
export const KANBAN_SEED: { k: string; c: KanCard[] }[] = [
  { k: "상담 전", c: [{ n: "문다온", g: "예시초5", s: "수학", m: "QR 접수" }, { n: "배시우", g: "예시중1", s: "영어" }] },
  { k: "상담 완료", c: [{ n: "임하율", g: "예시중2", s: "수학", m: "녹음" }] },
  { k: "미등록", c: [{ n: "조은서", g: "예시고1", s: "수학" }] },
  { k: "등록 완료", c: [{ n: "정하린", g: "예시초6", s: "영어", m: "반 배정" }] },
];

export const TODO_ITEMS = ["김하늘 학부모에게 결석 확인 전화", "고1 수학 어제 수업보고서 확인", "박서윤 후속 상담 (오늘 기한)", "9월 미납 안내"];

export const CONSULTS = [
  { n: "최도윤", sg: "예시중2", who: "수학 · 김선생", st: ["p-green", "AI 분석 완료"], d: "9/22", rec: "12:04",
    s: ["수학 숙제 미루는 습관 — 학부모 걱정", "수업 뒤 10분 풀이를 같이 확인하기로 함"], w: "수학 과제 미제출이 이어지면 이번 달 진도가 늦어질 수 있음" },
  { n: "박서윤", sg: "예시중1", who: "영어 · 이선생", st: ["p-amber", "후속 오늘"], d: "9/19", rec: "08:31",
    s: ["영어 반 레벨을 올리고 싶다는 문의", "레벨 확인 뒤 오늘까지 다시 연락하기로 함"], w: "기한 안에 연락하지 않으면 다른 학원 상담을 알아볼 수 있다고 함" },
  { n: "김하늘", sg: "예시중2", who: "수학 · 김선생", st: ["p-green", "AI 분석 완료"], d: "9/18", rec: "09:47",
    s: ["최근 2주 결석 2회 — 가족 일정", "9/23 14:30 보강 예약"], w: "결석이 더 이어지면 중2 A반 진도를 따라가기 어려울 수 있음" },
] as const;

export const STUDENT_NOTES: Record<string, string> = {
  김하늘: "결석이 이어져 학부모와 통화함. 9/23 14:30 보강 예약.",
  박서윤: "영어 레벨 올림 문의. 오늘까지 후속 상담.",
  최도윤: "수학 숙제 미루는 습관. 수업 뒤 10분 풀이 확인.",
};

export const OS_MENT = "하린이는 오늘 Unit 5 본문(42~45쪽)을 읽었고, 단어 테스트는 20문제 중 18개를 맞혔습니다. 수업 내내 집중이 좋았습니다. 틀린 두 단어는 다음 시간에 다시 확인하겠습니다. 오늘 과제는 워크북 20쪽입니다.";

export function seedAttendance(): AttMap {
  const a: AttMap = {};
  for (const [k, c] of Object.entries(CLASSES)) {
    a[k] = {};
    for (const [d] of c.slots) {
      a[k][d] = {};
      for (const n of c.roster) a[k][d][n] = d < TODAY ? "p" : "";
    }
  }
  a.e6[1] = { 정하린: "p", 노은채: "p" };
  a.m2a[1] = { 김하늘: "", 이준서: "p", 최도윤: "p", 서지안: "l" };
  return a;
}

export function todayProgress(att: AttMap) {
  let f = 0, t = 0;
  for (const k of Object.keys(CLASSES)) {
    const d = att[k][TODAY];
    if (!d) continue;
    for (const n of Object.keys(d)) { t++; if (d[n]) f++; }
  }
  return { f, t };
}
export const todayClassCount = (att: AttMap) => Object.keys(CLASSES).filter((k) => !!att[k][TODAY]).length;
export function classAtt(att: AttMap, k: string, d: number) {
  const o = att[k][d] ?? {};
  const names = Object.keys(o);
  return { f: names.filter((n) => !!o[n]).length, t: names.length };
}
export function todayStatus(att: AttMap, n: string): Att | null {
  let s: Att | null = null;
  for (const k of Object.keys(CLASSES)) {
    const o = att[k][TODAY];
    if (o && o[n] !== undefined && (s === null || o[n])) s = o[n];
  }
  return s;
}
export const absences = (att: AttMap, n: string) =>
  (PAST[n] ?? []).filter((v) => v === "a").length + (todayStatus(att, n) === "a" ? 1 : 0);
export const invoice = (n: string) => STUDENTS[n].subj.reduce((s, x) => s + FEE[x], 0);
export function billTotals(paid: Record<string, boolean>) {
  let t = 0, p = 0;
  const unpaid: string[] = [];
  for (const n of Object.keys(STUDENTS)) { const v = invoice(n); t += v; if (paid[n]) p += v; else unpaid.push(n); }
  return { t, p, unpaid, rate: Math.round((p / t) * 100) };
}
export const classesOf = (n: string) => Object.keys(CLASSES).filter((k) => CLASSES[k].roster.includes(n));
export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
