/**
 * 선생님 원스크린 — 데모 데이터 + 과목 색.
 * 프로토타입(data/원스크린_전달/data.js)의 STUDENTS / SUBJECT_COLORS 이식.
 * 데모 충실 이식이므로 DB가 아닌 정적 스냅샷. 강사 투어용 9명(A/B/C반).
 */
import type { OneScreenStudent, SubjectTone } from "./types";

/** 상단 날짜 라벨 — 데모 고정값(셀프투어 결정성 보장) */
export const TODAY = "2026년 6월 1일 (월)";

/** 수업 태도 선택지 */
export const ATTITUDE = ["아주 좋음", "좋음", "보통", "산만함", "피곤함"] as const;

/** 반 필터 칩 */
export const CLASS_TAGS = ["전체", "A반", "B반", "C반"] as const;

// ───────────────────────── 과목 색 (eywa 토큰 매핑) ─────────────────────────
// 프로토타입 색(eng=자홍 등)을 eywa 시간표 컨벤션에 맞춤:
//   수학=primary(forest) · 영어=blue · 국어=rose · 과학=purple · 사회=gold · 기타=neutral

export function subjectTone(name: string): { key: string; tone: SubjectTone } {
  if (name.includes("수학")) return { key: "수학", tone: "primary" };
  if (name.includes("영어")) return { key: "영어", tone: "blue" };
  if (name.includes("과학")) return { key: "과학", tone: "purple" };
  if (name.includes("국어")) return { key: "국어", tone: "rose" };
  if (name.includes("사회")) return { key: "사회", tone: "gold" };
  return { key: "기타", tone: "neutral" };
}

/** soft 배경 + 같은 색 텍스트 (칩) */
export function toneSoftClass(tone: SubjectTone): string {
  switch (tone) {
    case "primary":
      return "bg-primary-soft text-primary";
    case "blue":
      return "bg-blue-soft text-blue";
    case "rose":
      return "bg-rose-soft text-rose";
    case "purple":
      return "bg-purple-soft text-purple";
    case "gold":
      return "bg-gold-soft text-gold";
    default:
      return "bg-bg-soft text-text-dim";
  }
}

/** 솔리드 배경 (진도 바 / 과목 점) */
export function toneSolidClass(tone: SubjectTone): string {
  switch (tone) {
    case "primary":
      return "bg-primary";
    case "blue":
      return "bg-blue";
    case "rose":
      return "bg-rose";
    case "purple":
      return "bg-purple";
    case "gold":
      return "bg-gold";
    default:
      return "bg-ink/30";
  }
}

/** 텍스트 색 (과목명 / 화살표) */
export function toneTextClass(tone: SubjectTone): string {
  switch (tone) {
    case "primary":
      return "text-primary";
    case "blue":
      return "text-blue";
    case "rose":
      return "text-rose";
    case "purple":
      return "text-purple";
    case "gold":
      return "text-gold";
    default:
      return "text-text-dim";
  }
}

// ───────────────────────── 데모 학생 9명 ─────────────────────────

export const DEMO_ONESCREEN: OneScreenStudent[] = [
  {
    id: "s1",
    name: "김서연",
    grade: "중2",
    tag: "A반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "일차함수 §2", today: "일차함수 §3" },
      { name: "수학 심화", prev: "연립방정식 활용", today: "일차부등식" },
    ],
    tests: {
      daily: { score: 18, max: 20, prevScore: 16 },
      check: { score: 19, max: 20, prevScore: 17 },
    },
    attitude: "아주 좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: true,
  },
  {
    id: "s2",
    name: "이준호",
    grade: "중2",
    tag: "A반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "일차함수 §2", today: "일차함수 §3" },
      { name: "수학 심화", prev: "연립방정식 활용", today: "일차부등식" },
    ],
    tests: {
      daily: { score: 14, max: 20, prevScore: 15 },
      check: { score: null, max: 20, prevScore: 16 },
    },
    attitude: "보통",
    homework: "일부 미흡",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s3",
    name: "박지우",
    grade: "중2",
    tag: "A반",
    attendance: "지각",
    subjects: [
      { name: "수학 정규", prev: "일차함수 §2", today: "일차함수 §3" },
      { name: "수학 심화", prev: "연립방정식 활용", today: "일차부등식" },
    ],
    tests: {
      daily: { score: null, max: 20, prevScore: 19 },
      check: { score: null, max: 20, prevScore: 18 },
    },
    attitude: null,
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s4",
    name: "최민준",
    grade: "중3",
    tag: "B반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "이차함수 §3", today: "이차함수 §4" },
      { name: "수학 심화", prev: "이차방정식", today: "근과 계수" },
    ],
    tests: {
      daily: { score: 20, max: 20, prevScore: 18 },
      check: { score: 17, max: 20, prevScore: 19 },
    },
    attitude: "좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s5",
    name: "정하윤",
    grade: "중3",
    tag: "B반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "이차함수 §3", today: "이차함수 §4" },
      { name: "수학 심화", prev: "이차방정식", today: "근과 계수" },
    ],
    tests: {
      daily: { score: 11, max: 20, prevScore: 13 },
      check: { score: null, max: 20, prevScore: 12 },
    },
    attitude: "피곤함",
    homework: "미제출",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s6",
    name: "강도윤",
    grade: "중3",
    tag: "B반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "이차함수 §3", today: "이차함수 §4" },
      { name: "수학 심화", prev: "이차방정식", today: "근과 계수" },
    ],
    tests: {
      daily: { score: null, max: 20, prevScore: 17 },
      check: { score: null, max: 20, prevScore: 16 },
    },
    attitude: null,
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s7",
    name: "윤서아",
    grade: "고1",
    tag: "C반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "다항식의 연산", today: "나머지정리" },
      { name: "수학 심화", prev: "인수분해", today: "복소수" },
    ],
    tests: {
      daily: { score: 16, max: 20, prevScore: 16 },
      check: { score: 18, max: 20, prevScore: 15 },
    },
    attitude: "좋음",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s8",
    name: "임채원",
    grade: "고1",
    tag: "C반",
    attendance: "결석",
    subjects: [
      { name: "수학 정규", prev: "다항식의 연산", today: "나머지정리" },
      { name: "수학 심화", prev: "인수분해", today: "복소수" },
    ],
    tests: {
      daily: { score: null, max: 20, prevScore: 14 },
      check: { score: null, max: 20, prevScore: 15 },
    },
    attitude: null,
    homework: "—",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s9",
    name: "한지호",
    grade: "고1",
    tag: "C반",
    attendance: "출석",
    subjects: [
      { name: "수학 정규", prev: "다항식의 연산", today: "나머지정리" },
      { name: "수학 심화", prev: "인수분해", today: "복소수" },
    ],
    tests: {
      daily: { score: 13, max: 20, prevScore: 10 },
      check: { score: null, max: 20, prevScore: 11 },
    },
    attitude: "보통",
    homework: "완료",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
];
