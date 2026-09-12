import { expect, it } from "vitest";
import type { NewcomerRow } from "@/features/newcomers/server/queries";
import { newcomerStages } from "./newcomer-composition";

it("신규생을 학생 단위로 접어 과목별 구성과 기존 단계 합계를 보존한다", () => {
  const row = (id: string, keys: string[], bucket: NewcomerRow["bucket"] = "d7", active = keys.length > 0) => ({
    studentId: id, bucket, subject: null, hasCurrentEnrollment: active,
    subjects: keys.map((subject) => ({ subject }) as NewcomerRow),
  });
  const both = row("b", ["eng_custom", "math_custom", "math_custom"]);
  const stages = newcomerStages([
    row("e", ["eng_custom"]), both, both, row("m", ["math_custom"]),
    row("n", []), row("o", ["science"]), row("u", [], "d7", true), row("later", ["math_custom"], "d30"),
  ], [{ key: "eng_custom", label: "인재원 영어" }, { key: "math_custom", label: "수학(심화)" }]);
  expect(stages[0]).toEqual({ label: "0–7일", value: 6,
    subjects: { englishOnly: 1, both: 1, mathOnly: 1, otherOnly: 2, noEnrollment: 1 },
  });
  expect(stages[1].value).toBe(1);
  expect(stages.reduce((sum, stage) => sum + stage.value, 0)).toBe(7);
  expect(stages.every((stage) => Object.values(stage.subjects!).reduce((sum, count) => sum + count, 0) === stage.value)).toBe(true);
});
