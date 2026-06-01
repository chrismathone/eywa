// data.js — mock seed for 선생님 원스크린
// Attached to window.SEED so plain + babel scripts can read it.
(function () {
  const TODAY = "2026년 6월 1일 (월)";

  // attitude options shared
  const ATTITUDE = ["아주 좋음", "좋음", "보통", "산만함", "피곤함"];

  // Helper to build a student
  function S(o) {
    return Object.assign(
      {
        attitude: null,
        reportDraft: "",
        reportSent: false,
        homework: "완료",
      },
      o
    );
  }

  const STUDENTS = [
    S({
      id: "s1",
      name: "김서연",
      grade: "중2",
      tag: "A반",
      attendance: "출석",
      subjects: [
        { name: "영어 독해", prev: "Unit 7 · p.82", today: "Unit 8 · p.90" },
        { name: "영어 문법", prev: "관계대명사", today: "관계부사" },
      ],
      tests: {
        daily: { score: 18, max: 20, prevScore: 16 }, // 이전진도
        check: { score: 19, max: 20, prevScore: 17 }, // 오늘진도
      },
      attitude: "아주 좋음",
      homework: "완료",
      reportSent: true,
    }),
    S({
      id: "s2",
      name: "이준호",
      grade: "중2",
      tag: "A반",
      attendance: "출석",
      subjects: [
        { name: "영어 독해", prev: "Unit 7 · p.82", today: "Unit 8 · p.90" },
        { name: "영어 문법", prev: "관계대명사", today: "관계부사" },
      ],
      tests: {
        daily: { score: 14, max: 20, prevScore: 15 },
        check: { score: null, max: 20, prevScore: 16 },
      },
      attitude: "보통",
      homework: "일부 미흡",
    }),
    S({
      id: "s3",
      name: "박지우",
      grade: "중2",
      tag: "A반",
      attendance: "지각",
      subjects: [
        { name: "영어 독해", prev: "Unit 7 · p.82", today: "Unit 8 · p.90" },
        { name: "영어 문법", prev: "관계대명사", today: "관계부사" },
      ],
      tests: {
        daily: { score: null, max: 20, prevScore: 19 },
        check: { score: null, max: 20, prevScore: 18 },
      },
      attitude: null,
      homework: "완료",
    }),
    S({
      id: "s4",
      name: "최민준",
      grade: "중3",
      tag: "B반",
      attendance: "출석",
      subjects: [
        { name: "수학 (상)", prev: "이차함수 §3", today: "이차함수 §4" },
        { name: "영어 독해", prev: "Unit 11", today: "Unit 12" },
      ],
      tests: {
        daily: { score: 20, max: 20, prevScore: 18 },
        check: { score: 17, max: 20, prevScore: 19 },
      },
      attitude: "좋음",
      homework: "완료",
    }),
    S({
      id: "s5",
      name: "정하윤",
      grade: "중3",
      tag: "B반",
      attendance: "출석",
      subjects: [
        { name: "수학 (상)", prev: "이차함수 §3", today: "이차함수 §4" },
        { name: "영어 독해", prev: "Unit 11", today: "Unit 12" },
      ],
      tests: {
        daily: { score: 11, max: 20, prevScore: 13 },
        check: { score: null, max: 20, prevScore: 12 },
      },
      attitude: "피곤함",
      homework: "미제출",
    }),
    S({
      id: "s6",
      name: "강도윤",
      grade: "중3",
      tag: "B반",
      attendance: "출석",
      subjects: [
        { name: "수학 (상)", prev: "이차함수 §3", today: "이차함수 §4" },
        { name: "영어 독해", prev: "Unit 11", today: "Unit 12" },
      ],
      tests: {
        daily: { score: null, max: 20, prevScore: 17 },
        check: { score: null, max: 20, prevScore: 16 },
      },
      attitude: null,
      homework: "완료",
    }),
    S({
      id: "s7",
      name: "윤서아",
      grade: "고1",
      tag: "C반",
      attendance: "출석",
      subjects: [
        { name: "국어 문학", prev: "현대시 4강", today: "현대시 5강" },
        { name: "영어 어법", prev: "분사구문", today: "가정법" },
      ],
      tests: {
        daily: { score: 16, max: 20, prevScore: 16 },
        check: { score: 18, max: 20, prevScore: 15 },
      },
      attitude: "좋음",
      homework: "완료",
    }),
    S({
      id: "s8",
      name: "임채원",
      grade: "고1",
      tag: "C반",
      attendance: "결석",
      subjects: [
        { name: "국어 문학", prev: "현대시 4강", today: "현대시 5강" },
        { name: "영어 어법", prev: "분사구문", today: "가정법" },
      ],
      tests: {
        daily: { score: null, max: 20, prevScore: 14 },
        check: { score: null, max: 20, prevScore: 15 },
      },
      attitude: null,
      homework: "—",
    }),
    S({
      id: "s9",
      name: "한지호",
      grade: "고1",
      tag: "C반",
      attendance: "출석",
      subjects: [
        { name: "국어 문학", prev: "현대시 4강", today: "현대시 5강" },
        { name: "영어 어법", prev: "분사구문", today: "가정법" },
      ],
      tests: {
        daily: { score: 13, max: 20, prevScore: 10 },
        check: { score: null, max: 20, prevScore: 11 },
      },
      attitude: "보통",
      homework: "완료",
    }),
  ];

  window.SEED = { TODAY, ATTITUDE, STUDENTS };

  /* ---------- 과목별 색 (테마) ---------- */
  const SUBJECT_COLORS = {
    math: { key: "수학", ink: "#2563b8", soft: "#e7eefb" }, // 파랑
    eng:  { key: "영어", ink: "#b5318a", soft: "#f8e4f0" }, // 자홍
    sci:  { key: "과학", ink: "#7a5cd0", soft: "#ece6fb" }, // 연보라
    kor:  { key: "국어", ink: "#c2691f", soft: "#f6e8d6" }, // 주황
    soc:  { key: "사회", ink: "#1f8a7a", soft: "#dbf0ec" }, // 청록
    def:  { key: "기타", ink: "#5b6472", soft: "#ecedf1" },
  };
  function subjectColor(name) {
    if (!name) return SUBJECT_COLORS.def;
    if (name.includes("수학")) return SUBJECT_COLORS.math;
    if (name.includes("영어")) return SUBJECT_COLORS.eng;
    if (name.includes("과학")) return SUBJECT_COLORS.sci;
    if (name.includes("국어")) return SUBJECT_COLORS.kor;
    if (name.includes("사회")) return SUBJECT_COLORS.soc;
    return SUBJECT_COLORS.def;
  }
  window.SUBJECT_COLORS = SUBJECT_COLORS;
  window.subjectColor = subjectColor;
})();
