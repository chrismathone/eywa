/**
 * 보고서 한 건의 **시험 점수**를 칸에 적을 모양으로 편다 — 일일테스트 · 확인테스트 · (옛 기록) 시험점수. 순수(Vitest).
 *
 * 원장 2026-09-02 *"진도표에 일일테스트 점수(확인테스트 등) 연동"*. 재료는 `lesson_reports`의 세 칸이고
 * 우선순위는 학부모 카드([parent-report-card](../../onescreen/components/parent-report-card.tsx))와 **같다**:
 *  · `daily_test`·`check_test` — 원스크린이 2026-07부터 분리 저장(0082a). 실측(2026-07~09 3,976건): 일일 1,096건 ·
 *    확인 **1건**. 표기는 `"22문제 중 21개"`와 `"22문제 중 21개 맞음"` 두 벌이 섞여 있다.
 *  · `exam_info` — 옛 합본(`"일일 4/5"`·`"확인 8/10"`·맨 `"4/5"`). edutrix 이관분(2026-06·07 1,232건)은 **이것만** 있다.
 *    분리값이 하나라도 있으면 합본은 안 읽는다(원스크린은 둘 다 쓰므로 같은 점수가 두 번 서면 안 된다).
 *
 * 🔴 **점수 문자열을 새로 짓지 않는다** — 칸에는 저장된 원문을 그대로 두고 백분율만 곁들인다(표기 결정
 *    "N문제 중 M개 맞음" 하나뿐, 원장 2026-08-11). 변환은 [`parseExamPercent`](@/features/onescreen/report-trend)
 *    (학부모 추이 그래프와 같은 함수) — 여기서 다시 읽으면 화면마다 값이 갈린다.
 * 🔴 **모르면 라벨을 붙이지 않는다** — 옛 합본의 맨 `"4/5"`는 일일인지 확인인지 알 수 없어 `legacy`("시험")로
 *    두고, 일일테스트 평균(`dailyTestPercent`)에도 넣지 않는다(학부모 카드도 이걸 "시험점수" 한 줄로만 보여 준다).
 */
import { parseExamPercent } from "@/features/onescreen/report-trend";

export type TestScoreSource = {
  dailyTest: string | null;
  checkTest: string | null;
  /** 옛 합본(`exam_info`) — 분리값이 없을 때만 읽는다. */
  examInfo: string | null;
};

export type TestKind = "daily" | "check" | "legacy";

export type TestScoreView = {
  kind: TestKind;
  /** 저장된 원문(옛 합본에서 라벨을 떼어 낸 조각 포함) — 화면은 이걸 그대로 적는다. */
  raw: string;
  /** 정답률(0~100). 읽을 수 없는 표기면 null(원문만 보인다). */
  pct: number | null;
};

/** 칸에 붙는 짧은 라벨. */
export const TEST_KIND_LABEL: Record<TestKind, string> = { daily: "일일", check: "확인", legacy: "시험" };
/** 툴팁·표 머리용 긴 이름 — 학부모 카드의 Field 라벨과 같은 어휘. */
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

export function testScoresOf(src: TestScoreSource): TestScoreView[] {
  const out: TestScoreView[] = [];
  const daily = clean(src.dailyTest);
  const check = clean(src.checkTest);
  if (daily) out.push({ kind: "daily", raw: daily, pct: parseExamPercent(daily) });
  if (check) out.push({ kind: "check", raw: check, pct: parseExamPercent(check) });
  if (out.length > 0) return out;

  const legacy = clean(src.examInfo);
  if (!legacy) return out;
  for (const { kind, label } of LEGACY_LABELS) {
    // "일일 18/20" — 라벨 뒤의 분수 조각만 원문으로 남긴다(onescreen/exam-info.ts와 같은 모양을 읽는다).
    const m = legacy.match(new RegExp(`${label}\\s*(\\d+\\s*/\\s*\\d+)`));
    if (m) {
      const raw = m[1]!.replace(/\s+/g, "");
      out.push({ kind, raw, pct: parseExamPercent(raw) });
    }
  }
  if (out.length === 0) out.push({ kind: "legacy", raw: legacy, pct: parseExamPercent(legacy) });
  return out;
}

/**
 * 일일테스트 정답률 하나 — 평균(현황 표·카드)이 쓴다. 분리값 `daily_test`가 으뜸이고 없으면 옛 합본의
 * **`일일`이라 적힌** 조각만 인정한다(맨 분수는 무엇의 점수인지 몰라 뺀다).
 */
export function dailyTestPercent(src: TestScoreSource): number | null {
  return testScoresOf(src).find((t) => t.kind === "daily")?.pct ?? null;
}
