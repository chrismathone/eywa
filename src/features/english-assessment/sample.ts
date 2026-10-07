/**
 * 시안·테스트용 **예시 입력** — 가상의 학생(실제 원생 아님). 레퍼런스(NELT) 결과와 비슷한 모양이 나오게 짰다:
 * 어휘·문법·독해 초3~4, 듣기 중1 → 종합 Lv.2, 중1 학생이라 학년보다 2단계 아래.
 * 🔴 운영 화면에서 이 값을 쓰지 말 것 — 시안·테스트 전용이다.
 */
import type { AreaKey, ItemResult } from "./area";
import type { Level } from "./levels";
import type { AssessmentInput } from "./report";

type Row = [area: AreaKey, level: Level, correct: number, total: number, tag?: string];

const ROWS: Row[] = [
  ["vocab", 1, 4, 4],
  ["vocab", 2, 5, 6, "철자"],
  ["vocab", 3, 3, 6, "뜻 고르기"],
  ["grammar", 1, 4, 4],
  ["grammar", 2, 4, 6, "be동사·일반동사"],
  ["grammar", 3, 2, 6, "현재완료"],
  ["listening", 1, 2, 2],
  ["listening", 2, 4, 4],
  ["listening", 3, 4, 5, "대화 목적"],
  ["listening", 4, 3, 4, "세부 정보"],
  ["listening", 5, 1, 3, "세부 정보"],
  ["reading", 1, 3, 3],
  ["reading", 2, 4, 5, "세부 내용"],
  ["reading", 3, 2, 5, "주제 찾기"],
];

function expand(rows: Row[]): (ItemResult & { area: AreaKey })[] {
  return rows.flatMap(([area, level, correct, total, tag]) =>
    Array.from({ length: total }, (_, i) => ({ area, level, correct: i < correct, ...(tag ? { tag } : {}) })),
  );
}

/** 같은 학년(중1) 응시자 30명의 종합 수준 — L4 근처에 몰린 분포. */
const PEERS: Level[] = [
  1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 7,
];

export const SAMPLE_ASSESSMENT: AssessmentInput = {
  student: { name: "김예시", grade: "중1" },
  test: { title: "10월 영어 진단평가", date: "2026-10-07" },
  items: expand(ROWS),
  vocabSize: 950,
  homework: { assigned: 20, done: 18 },
  verbForms: [
    { base: "go", past: "went", pp: "gone", pastAnswer: "went", ppAnswer: "gone" },
    { base: "eat", past: "ate", pp: "eaten", pastAnswer: "ate", ppAnswer: "eaten" },
    { base: "write", past: "wrote", pp: "written", pastAnswer: "wrote", ppAnswer: "writed" },
    { base: "buy", past: "bought", pp: "bought", pastAnswer: "buyed", ppAnswer: "bought" },
    { base: "see", past: "saw", pp: "seen", pastAnswer: "saw", ppAnswer: "seen" },
    { base: "take", past: "took", pp: "taken", pastAnswer: "took", ppAnswer: "token" },
    { base: "make", past: "made", pp: "made", pastAnswer: "made", ppAnswer: "made" },
    { base: "come", past: "came", pp: "come", pastAnswer: "came", ppAnswer: "come" },
  ],
  timeSpent: {
    total: { mine: 2009, peerAvg: 2460 },
    vocab: { mine: 670, peerAvg: 540 },
    grammar: { mine: 397, peerAvg: 540 },
    listening: { mine: 496, peerAvg: 540 },
    reading: { mine: 446, peerAvg: 840 },
  },
  peerLevels: PEERS,
  teacherComment:
    "듣기는 학년 수준까지 올라와 있어요. 이번 달은 현재완료와 불규칙 동사 과거분사를 집중해서 연습하고, 매 수업 단어 시험으로 철자를 다져 보겠습니다. 숙제를 꾸준히 해 오고 있어서 다음 평가가 기대됩니다.",
};
