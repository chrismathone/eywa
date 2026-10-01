import { expect, it } from "vitest";
import { closedClassNameBase, nextClosedClassName, originalClassName } from "./closed-name";
it("종료일은 연·월·일까지 표시하고 이전 보관 접미사는 교체한다", () => {
  for (const name of ["PL5", "PL5 (~2026-07)", "PL5 (~26.07.02) 2", "PL5 (~종강)"])
    expect(closedClassNameBase(name, "2026-10-01")).toBe("PL5 (~26.10.01)");
  expect(originalClassName("드릴링 (월)")).toBe("드릴링 (월)");
  expect(closedClassNameBase("PL5 (~26.10.01)", "2026-10-01")).toBe("PL5 (~26.10.01)");
});
it("같은 종료일의 보관 이름이 겹치면 번호를 붙이고 원래 이름은 새 반에 비워 둔다", () => {
  expect(
    nextClosedClassName("PL5", "2026-10-01", ["PL5", "PL5 (~26.10.01)", "PL5 (~26.10.01) 2"]),
  ).toBe("PL5 (~26.10.01) 3");
});
it.each(["2026-02-30", "2026-13-01", "", "26.10.01"])("날짜 %s를 지어내지 않는다", (date) => {
  if (date) expect(() => closedClassNameBase("A", date)).toThrow();
  else expect(closedClassNameBase("A", null)).toBe("A (~종강)");
});
