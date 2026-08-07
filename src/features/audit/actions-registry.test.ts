import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 감사로그 액션 키 레지스트리 전수 스캔.
 *
 * 배경(2026-08-03): `auditActionLabel`이 미등록 키를 `?? a`로 폴백해 **영문 키 원문이 원장 화면에 그대로**
 * 떴다. log.ts 주석에 "새 액션은 반드시 등록"이라 적혀 있었지만 강제하는 게 없어 8개가 누락됐고, 그중
 * 5종은 이미 프로덕션에 쌓여 있었다(staff_password_reset·self_password_change·self_email_change·
 * class_archive·owner_integration_groups_update). 주석 대신 테스트로 잠근다.
 *
 * ⚠️ log.ts는 `import "server-only"`라 vitest에서 import할 수 없다 → 소스를 텍스트로 읽어 스캔한다.
 */

const SRC = path.join(process.cwd(), "src");
const LOG_TS = path.join(SRC, "features", "audit", "server", "log.ts");

/** AUDIT_ACTIONS 객체 리터럴의 키 집합. */
function registryKeys(): Set<string> {
  const src = fs.readFileSync(LOG_TS, "utf8");
  const start = src.indexOf("export const AUDIT_ACTIONS = {");
  const end = src.indexOf("} as const;", start);
  expect(start, "AUDIT_ACTIONS 선언을 찾지 못함 — 이 테스트의 스캔 방식을 갱신할 것").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);
  return new Set([...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):/gm)].map((m) => m[1]));
}

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** logAction( … ) 호출 블록에서 action 문자열 리터럴을 뽑는다(삼항 `a ? "x" : "y"` 포함). */
function usedActions(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of tsFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("logAction(")) continue;
    let i = 0;
    while ((i = src.indexOf("logAction(", i)) !== -1) {
      let j = i + "logAction(".length;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      for (const m of src.slice(i, j).matchAll(/action:\s*([^,\n]+)/g)) {
        // ⚠️ 값 자리에 **비교**가 섞이면(`action: x === "rotate" ? "a" : "b"`) 그 비교 문자열까지
        //    액션 키로 오인해 "미등록"으로 신고한다(2026-08-07 실측: rotate 오탐으로 main이 빨간불).
        //    비교식을 먼저 걷어내고 남은 문자열만 액션 후보로 본다 — 삼항의 두 갈래는 그대로 수집된다.
        const expr = m[1].replace(/[\w$.]+\s*[=!]==?\s*"[^"]*"/g, "");
        for (const q of expr.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
          const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
          if (!found.has(q[1])) found.set(q[1], new Set());
          found.get(q[1])!.add(rel);
        }
      }
      i = j;
    }
  }
  return found;
}

describe("감사로그 액션 레지스트리", () => {
  it("스캔이 실제로 동작한다(호출부를 하나도 못 찾으면 통과는 무의미)", () => {
    const used = usedActions();
    expect(used.size).toBeGreaterThan(20);
    expect(used.has("staff_role_change")).toBe(true);
  });

  it("logAction으로 기록하는 모든 액션이 AUDIT_ACTIONS에 한글 라벨로 등록돼 있다", () => {
    const registry = registryKeys();
    const missing = [...usedActions()]
      .filter(([key]) => !registry.has(key))
      .map(([key, files]) => `${key}  ←  ${[...files].join(", ")}`);

    expect(
      missing,
      `AUDIT_ACTIONS 미등록 액션 — 감사로그 화면에 영문 키가 그대로 노출된다.\n` +
        `src/features/audit/server/log.ts에 한글 라벨을 추가하고, metadata가 영문 키를 담으면 ` +
        `describe.ts에도 상세 한글화를 추가할 것:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("라벨은 비어 있지 않고 영문 키를 그대로 쓰지 않는다", () => {
    const src = fs.readFileSync(LOG_TS, "utf8");
    const body = src.slice(
      src.indexOf("export const AUDIT_ACTIONS = {"),
      src.indexOf("} as const;", src.indexOf("export const AUDIT_ACTIONS = {")),
    );
    const bad = [...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"([^"]*)"/gm)]
      .filter(([, key, label]) => label.trim() === "" || label === key || !/[가-힣]/.test(label))
      .map(([, key, label]) => `${key}: "${label}"`);
    expect(bad, `한글 라벨이 아닌 항목:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});
