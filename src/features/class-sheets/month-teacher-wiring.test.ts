/**
 * **월간 뷰의 교시 담당은 주간 시트·시간표와 같은 이름을 보여준다** — 회귀 방지.
 *
 * 원장 제보 2026-09-04 *"강사 시트랑 배선이 다르게 되어있나? 수업 스케줄에서"*.
 * 실측(`중등E_중1 정규 B`, 9월):
 *   · 화 18:20 — 라벨 `Song` · teacher_id 송지혜 → 시간표 **송지혜** / 월간 **Song**
 *   · 화 19:20 — 라벨 **없음** · teacher_id 추민아 → 시간표 **추민아** / 월간 **담당 미지정**
 * 원인은 로더 하나였다: 월간만 `slot_teacher_label`을 **날것 그대로** 실었다(FK도 안 읽었다).
 * 주간 시트는 같은 자리에서 ① 라벨을 `resolveTeacherLabel`로 해석하고 ② 없으면 슬롯 담당 →
 * ③ 그래도 없으면 담임으로 떨어진다(`period-block.tsx`).
 *
 * 🔴 **라벨이 먼저다.** 라벨과 FK가 서로 다른 사람을 가리키는 슬롯이 실제로 있어서, FK를 앞세우면
 *    시간표와 어긋난 이름이 월간에만 뜬다(changelog 2026-07-29).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "src", "features", "class-sheets", "server", "month-queries.ts"),
  "utf8",
);
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const code = codeOnly(src);

describe("월간 뷰 교시 담당 — 주간 시트와 같은 배선", () => {
  it("🔴 슬롯 담당 FK를 읽는다 — 라벨만 읽으면 라벨 없는 교시가 '담당 미지정'이 된다", () => {
    expect(code).toMatch(/teacher_id, slot_teacher_label/);
  });

  it("🔴 라벨을 해석기에 통과시킨다 — 닉네임(`Song`)이 그대로 뜨지 않게", () => {
    expect(code).toContain("resolveTeacherLabel(");
    expect(code).toContain("getTeacherLabelMap(");
    // 날것을 그대로 싣던 옛 줄이 되살아나지 않게.
    expect(code).not.toMatch(/slotTeacherLabel:\s*\(r\.slot_teacher_label/);
  });

  it("🔴 폴백 순서가 라벨 → 슬롯 담당 → 담임", () => {
    const at = code.indexOf("const displayTeacherOf");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, at + 500);
    const iLabel = body.indexOf("resolveTeacherLabel");
    const iSlot = body.indexOf("slotTeacherNames[");
    const iHome = body.indexOf("classTeacherName");
    expect(iLabel).toBeGreaterThan(-1);
    expect(iSlot).toBeGreaterThan(iLabel); // 라벨이 먼저
    expect(iHome).toBeGreaterThan(iSlot); // 담임이 마지막
  });

  it("담임 이름을 두 번 읽지 않는다 — 같은 값이 한 변수에서 나온다", () => {
    expect(code).toContain("const classTeacherName =");
    expect(code).toContain("teacherName: classTeacherName,");
  });
});
