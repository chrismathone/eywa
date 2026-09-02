/**
 * 보고서 한 건의 **시험 점수**를 칸에 적을 모양으로 편다 — 일일테스트 · 확인테스트 · (옛 기록) 시험점수. 순수(Vitest).
 *
 * 원장 2026-09-02 *"진도표에 일일테스트 점수(확인테스트 등) 연동"* → *"%는 제외하고 정답 개수/전체 개수만"*. 재료는
 * `lesson_reports`의 세 칸이고 우선순위는 학부모 카드([parent-report-card](../../onescreen/components/parent-report-card.tsx))와
 * **같다**:
 *  · `daily_test`·`check_test` — 원스크린이 2026-07부터 분리 저장(0082a). 실측(2026-07~09 3,976건): 일일 1,096건 ·
 *    확인 **1건**. 표기는 `"22문제 중 21개"`와 `"22문제 중 21개 맞음"` 두 벌이 섞여 있다.
 *  · `exam_info` — 옛 합본(`"일일 4/5"`·`"확인 8/10"`·맨 `"4/5"`). edutrix 이관분(2026-06·07 1,232건)은 **이것만** 있다.
 *    분리값이 하나라도 있으면 합본은 안 읽는다(원스크린은 둘 다 쓰므로 같은 점수가 두 번 서면 안 된다).
 *
 * 🔴 **점수 문자열을 새로 짓지 않는다** — 칸에는 맞은 개수/전체(`13/22`)만 적고 원문은 툴팁에 둔다(표기 결정
 *    "N문제 중 M개 맞음" 하나뿐, 원장 2026-08-11 — 학부모 보고서 문장은 그대로다).
 * 🔴 **모르면 라벨을 붙이지 않는다** — 옛 합본의 맨 `"4/5"`는 일일인지 확인인지 알 수 없어 `legacy`("시험")로 둔다
 *    (학부모 카드도 이걸 "시험점수" 한 줄로만 보여 준다).
 */
export type TestScoreSource = {
  dailyTest: string | null;
  checkTest: string | null;
  /** 옛 합본(`exam_info`) — 분리값이 없을 때만 읽는다. */
  examInfo: string | null;
};

export type TestKind = "daily" | "check" | "legacy";

export type TestScoreView = {
  kind: TestKind;
  /** 저장된 원문(옛 합본에서 라벨을 떼어 낸 조각 포함) — 툴팁은 이걸 그대로 적는다. */
  raw: string;
  /** 맞은 개수 · 전체 개수 — 칸에는 이 둘만 `13/22`로 적는다. 읽을 수 없는 표기면 null(원문만 보인다). */
  correct: number | null;
  total: number | null;
};

/** 칸에 붙는 짧은 라벨. */
export const TEST_KIND_LABEL: Record<TestKind, string> = { daily: "일일", check: "확인", legacy: "시험" };
/** 툴팁용 긴 이름 — 학부모 카드의 Field 라벨과 같은 어휘. */
export const TEST_KIND_TITLE: Record<TestKind, string> = {
  daily: "일일테스트",
  check: "확인테스트",
  legacy: "시험점수(옛 기록)",
};

function clean(s: string | null | undefined): string | null {
  const t = s?.trim() ?? "";
  return t ? t : null;
}

const LEGACY_LABELS: readonly { kind: TestKind; label: string }[] = [
  { kind: "daily", label: "일일" },
  { kind: "check", label: "확인" },
];

/** "22문제 중 21개(맞음)" · "21/22" → 맞은 개수·전체 개수. 둘 다 못 읽으면 null(`parseExamPercent`와 같은 두 모양). */
function parseCounts(raw: string): { correct: number; total: number } | null {
  const korean = raw.match(/(\d+)\s*문제\s*중\s*(\d+)\s*개/);
  if (korean) return { total: parseInt(korean[1]!, 10), correct: parseInt(korean[2]!, 10) };
  const fraction = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) return { correct: parseInt(fraction[1]!, 10), total: parseInt(fraction[2]!, 10) };
  return null;
}

function view(kind: TestKind, raw: string): TestScoreView {
  const counts = parseCounts(raw);
  return { kind, raw, correct: counts?.correct ?? null, total: counts?.total ?? null };
}

export function testScoresOf(src: TestScoreSource): TestScoreView[] {
  const out: TestScoreView[] = [];
  const daily = clean(src.dailyTest);
  const check = clean(src.checkTest);
  if (daily) out.push(view("daily", daily));
  if (check) out.push(view("check", check));
  if (out.length > 0) return out;

  const legacy = clean(src.examInfo);
  if (!legacy) return out;
  for (const { kind, label } of LEGACY_LABELS) {
    // "일일 18/20" — 라벨 뒤의 분수 조각만 원문으로 남긴다(onescreen/exam-info.ts와 같은 모양을 읽는다).
    const m = legacy.match(new RegExp(`${label}\\s*(\\d+\\s*/\\s*\\d+)`));
    if (m) out.push(view(kind, m[1]!.replace(/\s+/g, "")));
  }
  if (out.length === 0) out.push(view("legacy", legacy));
  return out;
}

/** 칸에 적는 짧은 형태 — `13/22`(맞은 개수/전체). 개수를 못 읽는 표기("미응시")는 원문 그대로. */
export function testCountLabel(t: TestScoreView): string {
  return t.correct != null && t.total != null ? `${t.correct}/${t.total}` : t.raw;
}
