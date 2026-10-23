import { afterEach, expect, it, vi } from "vitest";
import { keyGroupOf, keyLabelOf, resolveKeyEnv } from "@/lib/ai/models";
afterEach(() => vi.unstubAllEnvs());
it("원생 온톨로지 전용 키와 사용량을 출결 그룹에서 분리", () => {
  vi.stubEnv("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY", "test-key");
  const group = keyGroupOf("student_positive_signal");
  expect(group).toBe("student_ontology");
  const env = resolveKeyEnv("anthropic", "default", group);
  expect(env).toBe("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY");
  expect(keyLabelOf("anthropic", env)).toBe("student_ontology");
  expect(keyGroupOf("parent_satisfaction")).toBe("attendance");
});
