/**
 * 선생님 원스크린 — 데모 데이터.
 * 한 수학 강사가 보습식으로 초3~중3을 지도하는 설정. 학생 9명을 학년에 분산하고,
 * 진도(prev/today)는 각 학생 학년의 커리큘럼(curriculum.ts) 차시 문자열을 그대로 쓴다.
 * 데모 충실 이식이므로 정적 스냅샷(DB·AI 없음). tag=학년 → 반 필터가 학년 필터로 동작.
 */
import type { OneScreenStudent } from "./types";

// ───────── 데모 학생 9명 — 초3~중3 분산, 수학 단일 과목, 진도=커리큘럼 차시 ─────────

export const DEMO_ONESCREEN: OneScreenStudent[] = [
  {
    id: "s1",
    name: "김서연",
    grade: "초3",
    tag: "초3",
    attendance: "출석",
    subjects: [
      {
        name: "수학",
        prev: "1-1-1 받아올림이 없는, 한 번 있는 (세 자리 수)+(세 자리 수)",
        today: "1-1-2 받아올림이 두 번, 세 번 있는 (세 자리 수)+(세 자리 수)",
      },
    ],
    tests: {
      daily: { score: 18, max: 20, prevScore: 16 },
      check: { score: 19, max: 20, prevScore: 17 },
    },
    attitude: "매우 좋음",
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: true,
  },
  {
    id: "s2",
    name: "이준호",
    grade: "초4",
    tag: "초4",
    studyGrade: "초5", // 선행 — 실제 초4, 진도 초5
    attendance: "출석",
    subjects: [
      {
        name: "수학",
        prev: "1-1-2 덧셈, 뺄셈, 곱셈(나눗셈)이 섞여 있는 식",
        today: "1-1-3 덧셈, 뺄셈, 곱셈, 나눗셈이 섞여 있는 식",
      },
    ],
    tests: {
      daily: { score: 14, max: 20, prevScore: 15 },
      check: { score: null, max: 20, prevScore: 16 },
    },
    attitude: "보통",
    homework: "90%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s3",
    name: "박지우",
    grade: "초5",
    tag: "초5",
    attendance: "지각",
    subjects: [
      { name: "수학", prev: "1-2-1 약수와 배수", today: "1-2-2 약수와 배수의 관계" },
    ],
    tests: {
      daily: { score: null, max: 20, prevScore: 19 },
      check: { score: null, max: 20, prevScore: 18 },
    },
    attitude: null,
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s4",
    name: "최민준",
    grade: "초6",
    tag: "초6",
    studyGrade: "중1", // 선행 — 실제 초6, 진도 중1
    attendance: "출석",
    subjects: [{ name: "수학", prev: "소인수분해", today: "공약수와 최대공약수" }],
    tests: {
      daily: { score: 20, max: 20, prevScore: 18 },
      check: { score: 17, max: 20, prevScore: 19 },
    },
    attitude: "좋음",
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s5",
    name: "정하윤",
    grade: "중1",
    tag: "중1",
    attendance: "출석",
    subjects: [{ name: "수학", prev: "등식의 성질", today: "일차방정식의 풀이" }],
    tests: {
      daily: { score: 11, max: 20, prevScore: 13 },
      check: { score: null, max: 20, prevScore: 12 },
    },
    attitude: "안좋음",
    homework: "0%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s6",
    name: "강도윤",
    grade: "중1",
    tag: "중1",
    studyGrade: "초6", // 후행/복습 — 실제 중1, 진도 초6
    attendance: "출석",
    subjects: [{ name: "수학", prev: "1-4-1 두 수 비교하기", today: "1-4-2 비" }],
    tests: {
      daily: { score: null, max: 20, prevScore: 17 },
      check: { score: null, max: 20, prevScore: 16 },
    },
    attitude: null,
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s7",
    name: "윤서아",
    grade: "중2",
    tag: "중2",
    attendance: "출석",
    subjects: [
      { name: "수학", prev: "일차함수의 그래프와 절편", today: "일차함수의 그래프와 기울기" },
    ],
    tests: {
      daily: { score: 16, max: 20, prevScore: 16 },
      check: { score: 18, max: 20, prevScore: 15 },
    },
    attitude: "좋음",
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
  {
    id: "s8",
    name: "임채원",
    grade: "중3",
    tag: "중3",
    attendance: "결석",
    subjects: [
      { name: "수학", prev: "이차방정식의 풀이", today: "이차방정식의 근의 공식과 응용" },
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
    grade: "중3",
    tag: "중3",
    attendance: "출석",
    subjects: [{ name: "수학", prev: "삼각비의 뜻", today: "삼각비의 값" }],
    tests: {
      daily: { score: 13, max: 20, prevScore: 10 },
      check: { score: null, max: 20, prevScore: 11 },
    },
    attitude: "보통",
    homework: "100%",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  },
];
