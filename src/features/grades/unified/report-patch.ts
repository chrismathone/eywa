import { testScoresOf } from "@/features/math-sheets/lib/test-score";

export type ReportFields = { daily_test: string | null; check_test: string | null; exam_info: string | null };

/** 점수가 바뀌지 않았으면 원문을 보존한다. 옛 합본을 고칠 때는 다른 시험도 분리 칸으로 옮긴다. */
export function reportScorePatch(
  fields: ReportFields, kind: "daily" | "check" | "other", score: number | null, maxScore: number | null,
): Record<string, string | null> | null {
  const stored = testScoresOf({ dailyTest: fields.daily_test, checkTest: fields.check_test, examInfo: fields.exam_info })
    .find((test) => test.kind === (kind === "other" ? "legacy" : kind));
  if (stored && (stored.correct === score && stored.total === maxScore || score == null && stored.correct == null)) return null;
  const value = score == null ? null : `${score}/${maxScore}`;
  if (kind === "other") return { exam_info: value };
  const field = kind === "daily" ? "daily_test" : "check_test";
  const patch: Record<string, string | null> = { [field]: value };
  if (!fields.daily_test && !fields.check_test && fields.exam_info) {
    const other = kind === "daily" ? "확인" : "일일";
    const otherValue = fields.exam_info.match(new RegExp(`${other}\\s*(\\d+\\s*\/\\s*\\d+)`))?.[1];
    if (otherValue) patch[kind === "daily" ? "check_test" : "daily_test"] = otherValue.replace(/\s+/g, "");
    patch.exam_info = null;
  }
  return patch;
}
