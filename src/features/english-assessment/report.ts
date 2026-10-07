/**
 * 영어 평가 성적표 **파이프라인** — 입력(문항 정오·숙제·동사변화·동학년 수준들) → 성적표 화면이 그대로 그릴 값.
 * 원장 2026-10-07: *"테스트 성적 · 메달 · 단어 수준(몇 학년) · 영역별 정답률 · 풀이 · 학습 위치 · 전하는 말(매우 중요) ·
 * 동사변화표 · 오답분석 · 종합평가 · 학년 평균 대비 · 좌측 숙제 완성도 + 우측 항목별 평가 · 종합 수준 + 선생님 코멘트 ·
 * 동학년 대비 나의 실력"* — 레퍼런스 NELT 성적표.
 *
 * 🔴 **사실만**: 문장은 계산된 숫자에서만 만든다(창작 금지 — AI 사실 원칙과 같은 바닥). 재료가 없는 칸은 null로 두고
 *    화면이 그 블록을 감춘다(빈 칸을 그럴듯한 말로 채우지 않는다).
 * 🔴 선생님 코멘트(전하는 말)는 **사람이 쓴 글 그대로** 싣는다 — 여기서 다듬지 않는다.
 * ⚠️ 아직 어디에도 배선되지 않았다(2026-10-07 — 시안·파이프라인 단계). 수업보고서에 붙일 때 이 함수 하나를 부른다.
 */
import { AREA_LABEL, AREA_ORDER, scoreArea, wrongAnswerGroups, type AreaKey, type AreaResult, type ItemResult } from "./area";
import { gradeToLevel, levelLabel, levelShort, type Level } from "./levels";
import { buildPeerGroup, topPercent, type PeerGroup } from "./peers";

export type VerbFormAnswer = { base: string; past: string; pp: string; pastAnswer: string; ppAnswer: string };

export type AssessmentInput = {
  student: { name: string; grade: string | null };
  test: { title: string; date: string };
  items: (ItemResult & { area: AreaKey })[];
  /** 추정 어휘량(단어 수) — 단어 학습 프로그램 값. 없으면 표에서 뺀다. */
  vocabSize?: number | null;
  /** 숙제 — 낸 개수·해 온 개수. 없으면 블록을 감춘다. */
  homework?: { assigned: number; done: number } | null;
  verbForms?: VerbFormAnswer[];
  /** 영역별 소요 시간(초) — 나·동학년 평균. 없으면 블록을 감춘다. */
  timeSpent?: Partial<Record<AreaKey | "total", { mine: number; peerAvg: number | null }>> | null;
  /** 같은 학년 응시자들의 종합 수준(나 포함 여부는 호출부 몫). `MIN_PEERS` 미만이면 비교를 안 낸다. */
  peerLevels?: Level[];
  /** 선생님 코멘트(전하는 말) — 사람이 쓴 글 그대로. */
  teacherComment?: string | null;
};

export type Medal = "gold" | "silver" | "bronze" | null;
export const MEDAL_LABEL: Record<Exclude<Medal, null>, string> = { gold: "금메달", silver: "은메달", bronze: "동메달" };
/** 메달 문턱 — 시험 전체 정답률. 학원이 바꾸고 싶으면 이 표만 고친다. */
export const MEDAL_RULES: readonly { medal: Exclude<Medal, null>; minRate: number }[] = [
  { medal: "gold", minRate: 0.9 },
  { medal: "silver", minRate: 0.8 },
  { medal: "bronze", minRate: 0.7 },
];

export type AssessmentReport = {
  student: AssessmentInput["student"];
  test: AssessmentInput["test"] & { correct: number; total: number; rate: number | null; medal: Medal };
  areas: AreaResult[];
  /** 종합 수준 = 영역 도달 수준의 **아래쪽 중앙값**(한 영역만 튀어도 전체가 끌려가지 않게). 영역이 하나도 없으면 null. */
  overall: { level: Level; label: string; short: string } | null;
  /** 학년 기대 수준 대비 — 위·같음·아래(학년을 모르면 null). */
  vsGrade: { expected: Level; diff: number } | null;
  vocab: { level: Level | null; size: number | null } | null;
  peers: (PeerGroup & { topPercent: number | null }) | null;
  wrong: ReturnType<typeof wrongAnswerGroups>;
  homework: { assigned: number; done: number; rate: number } | null;
  verbs: { rows: (VerbFormAnswer & { pastOk: boolean; ppOk: boolean })[]; correct: number; total: number } | null;
  timeSpent: AssessmentInput["timeSpent"];
  /** 풀이 — 숫자로만 만든 문장들(첫 줄 = "이 친구는 ○학년 수준에서 ○% …"). */
  summary: string[];
  teacherComment: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();
const pct = (r: number) => `${Math.round(r * 100)}%`;

export function medalOf(rate: number | null): Medal {
  if (rate === null) return null;
  return MEDAL_RULES.find((m) => rate >= m.minRate)?.medal ?? null;
}

export function buildAssessmentReport(input: AssessmentInput): AssessmentReport {
  const areas = AREA_ORDER.map((a) => scoreArea(a, input.items.filter((i) => i.area === a))).filter((r) => r.total > 0);
  const correct = areas.reduce((s, a) => s + a.correct, 0);
  const total = areas.reduce((s, a) => s + a.total, 0);
  const rate = total > 0 ? correct / total : null;

  const levels = areas.map((a) => a.level).filter((l): l is Level => l !== null).sort((x, y) => x - y);
  const overallLevel = levels.length ? levels[Math.floor((levels.length - 1) / 2)]! : null;
  const overall = overallLevel ? { level: overallLevel, label: levelLabel(overallLevel), short: levelShort(overallLevel) } : null;
  const expected = gradeToLevel(input.student.grade);
  const vsGrade = overallLevel && expected ? { expected, diff: overallLevel - expected } : null;

  const group = input.peerLevels ? buildPeerGroup(input.peerLevels) : null;
  const peers = group ? { ...group, topPercent: overallLevel ? topPercent(group, overallLevel) : null } : null;

  const vocabArea = areas.find((a) => a.area === "vocab");
  const vocab =
    vocabArea || input.vocabSize != null ? { level: vocabArea?.level ?? null, size: input.vocabSize ?? null } : null;

  const hw = input.homework && input.homework.assigned > 0
    ? { ...input.homework, rate: Math.min(1, input.homework.done / input.homework.assigned) }
    : null;

  const verbRows = (input.verbForms ?? []).map((v) => ({
    ...v,
    pastOk: norm(v.pastAnswer) === norm(v.past),
    ppOk: norm(v.ppAnswer) === norm(v.pp),
  }));
  const verbs = verbRows.length
    ? { rows: verbRows, correct: verbRows.reduce((s, r) => s + (r.pastOk ? 1 : 0) + (r.ppOk ? 1 : 0), 0), total: verbRows.length * 2 }
    : null;

  return {
    student: input.student,
    test: { ...input.test, correct, total, rate, medal: medalOf(rate) },
    areas,
    overall,
    vsGrade,
    vocab,
    peers,
    wrong: wrongAnswerGroups(input.items),
    homework: hw,
    verbs,
    timeSpent: input.timeSpent ?? null,
    summary: summarize(input.student.name, areas, overall, vsGrade, rate),
    teacherComment: input.teacherComment?.trim() || null,
  };
}

/**
 * 풀이 문장 — 원장 틀 *"이 친구는 ( ) 학년 수준에 ( ) 정도 맞았기 때문에 앞으로 학습 현황 · 위치가 어디 있는지"*.
 * 숫자에서만 만든다. 영역이 없으면 빈 배열(화면이 블록을 감춘다).
 */
function summarize(
  name: string,
  areas: AreaResult[],
  overall: AssessmentReport["overall"],
  vsGrade: AssessmentReport["vsGrade"],
  rate: number | null,
): string[] {
  if (!overall || rate === null) return [];
  const lines: string[] = [];
  lines.push(`${name} 학생은 이번 평가에서 전체 ${pct(rate)}를 맞혔고, 종합 수준은 ${overall.label} 수준입니다.`);
  if (vsGrade) {
    const where =
      vsGrade.diff > 0 ? `학년보다 ${vsGrade.diff}단계 앞서 있습니다` : vsGrade.diff < 0 ? `학년 기준보다 ${-vsGrade.diff}단계 아래에 있습니다` : "학년 수준에 맞게 와 있습니다";
    lines.push(`지금 학년(${levelShort(vsGrade.expected)}) 기준으로 보면 ${where}.`);
  }
  const parts = areas.filter((a) => a.level !== null).map((a) => `${AREA_LABEL[a.area]} ${levelShort(a.level!)}`);
  if (parts.length) lines.push(`영역별로는 ${parts.join(" · ")} 수준입니다.`);
  // 다음 단계 — 가장 낮은 영역을 짚는다(같으면 정답률이 낮은 쪽).
  const weakest = [...areas]
    .filter((a) => a.level !== null)
    .sort((a, b) => a.level! - b.level! || (a.rate ?? 0) - (b.rate ?? 0))[0];
  if (weakest && weakest.level! < 9) {
    const next = (weakest.level! + 1) as Level;
    const progress = weakest.nextLevelRate !== null ? ` (현재 그 수준 문항 ${pct(weakest.nextLevelRate)} 정답)` : "";
    lines.push(`다음 목표는 ${withObject(AREA_LABEL[weakest.area])} ${levelShort(next)} 수준으로 올리는 것입니다${progress}.`);
  }
  return lines;
}

/** 목적격 조사 — 받침 있으면 "을", 없으면 "를"("문법을" · "어휘를"). 한글이 아니면 "을(를)". */
function withObject(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}을(를)`;
  return `${word}${code % 28 === 0 ? "를" : "을"}`;
}
