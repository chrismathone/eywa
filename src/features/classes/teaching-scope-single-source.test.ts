/**
 * "내가 가르치는 반" 판정이 **여러 벌로 복제되는 것**을 막는 회귀 테스트 (0173a 반 임시 위임).
 *
 * 배경: `supabase.from("classes")...eq("teacher_id", user.id)`가 원스크린·출석부 서버 코드 10곳에
 * 흩어져 있었다. 임시 위임(결근 대체)을 더하려면 **전부 같이** 바뀌어야 하는데, 하나라도 남으면
 * "화면엔 뜨는데 저장하면 거절" 또는 그 반대가 된다(2026-08-03 담임 역할 배열이 세 벌로 갈라져
 * 같은 증상이 났다). → 이 두 표면에서는 `getTeachingClassIds`/`getTeachingClasses`만 쓴다.
 *
 * ⚠️ **일부러 대상에서 뺀 곳**: 급여·정산(`features/attendance/server/teacher-money.ts`)은
 *    `classes.teacher_id`를 그대로 본다. 돈은 **담임을 따라간다** — 하루 대신 들어간 강사에게
 *    급여가 옮겨가면 안 된다. 위임은 "누가 보고서를 쓰는가"만 바꾼다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(안 그러면 경고 주석 자체가 위반으로 걸린다). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("담당 반 판정 단일 소스", () => {
  it("원스크린·출석부 서버 코드는 classes.teacher_id를 직접 조회하지 않는다", () => {
    const roots = [
      join(process.cwd(), "src", "features", "onescreen"),
      join(process.cwd(), "src", "features", "attendance", "server"),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        // teacher-money = 돈 계산(위 주석의 의도적 예외).
        if (file.includes("teacher-money")) continue;
        const code = stripComments(readFileSync(file, "utf8")).replace(/\s+/g, " ");
        // `from("classes")` 와 같은 체인 안의 `.eq("teacher_id"` — 사이에 select/filter가 끼어도 잡히게 넉넉히.
        if (/from\(\s*["']classes["']\s*\)[^;]{0,400}?\.eq\(\s*["']teacher_id["']/.test(code)) {
          offenders.push(file.replace(process.cwd(), ""));
        }
      }
    }
    expect(
      offenders,
      `담당 반은 getTeachingClassIds/getTeachingClasses(@/features/classes/server/delegation)로 판정할 것 — ` +
        `직접 조회하면 위임받은 반이 빠져 대체 강사가 수업하고도 보고서를 못 씁니다:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("두 소비처가 같은 모듈을 import한다(경로가 갈라지면 이 테스트가 무의미해진다)", () => {
    const files = [
      join(process.cwd(), "src", "features", "onescreen", "server", "roster.ts"),
      join(process.cwd(), "src", "features", "onescreen", "server", "actions.ts"),
      join(process.cwd(), "src", "features", "onescreen", "server", "scope.ts"),
    ];
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).toContain("@/features/classes/server/delegation");
    }
  });

  /**
   * 출결 쓰기는 2026-08-18부터 축이 **한 겹 넓다**: 담임 ∪ 위임 ∪ **그 교시 담당**.
   * 출석부의 읽기 축이 (담임 ∪ 교시 담당)으로 넓어졌는데 쓰기만 담임 ∪ 위임이면, 슬롯 담당 강사에게
   * 반이 **보이는데 저장이 막힌다**(실측: Florence Park = teacher·슬롯 9·담임 0). 그래서 출결 액션은
   * `userTaughtClassSet`(write-policy)을 쓴다 — 그 함수가 **내부에서** delegation을 부르므로
   * "담당 반 판정을 재구현하지 않는다"는 이 파일의 취지는 그대로다. 사슬이 끊기지 않는지 함께 잠근다.
   */
  it("출결 액션은 교시 담당까지 포함한 축을 쓰고, 그 축은 여전히 delegation을 통과한다", () => {
    const actions = readFileSync(
      join(process.cwd(), "src", "features", "attendance", "server", "actions.ts"),
      "utf8",
    );
    expect(actions).toContain("userTaughtClassSet");
    expect(actions).not.toContain("getTeachingClassIds"); // 좁은 축으로 되돌아가지 않게

    const policy = readFileSync(
      join(process.cwd(), "src", "features", "attendance", "live", "server", "write-policy.ts"),
      "utf8",
    );
    expect(policy).toContain("@/features/classes/server/delegation");
    expect(policy).toContain("class_schedules"); // 교시 담당을 실제로 더한다
  });
});
