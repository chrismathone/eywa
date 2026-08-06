import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 연동 PC 워커 스크립트 **파스 가능성** 전수 검사.
 *
 * 배경(2026-08-06 실사고): 회수 기능을 넣으며 `const rres`를 선언했는데 같은 블록에 이미 `rres`가 있었다
 * (읽음 동기화). 중복 선언 = **파일 전체 SyntaxError**라 데몬이 아예 기동하지 못한다 — 그러면 회수뿐 아니라
 * **발송·공지까지 전부 선다.**
 *
 * 🔴 이 부류는 기존 게이트가 **하나도** 못 잡는다: 워커는 `.mjs`라 `tsc`가 안 보고, `next build`는 src만 묶고,
 *    Vitest는 이 파일들을 import하지 않으며(핵심 로직만 따로 테스트), 실행은 **물리적으로 다른 PC**에서 일어난다.
 *    그래서 "검증 다 통과"라고 말한 코드가 연동 PC에서 기동조차 못 하는 상태로 zip에 실렸다.
 *
 * 파스만 본다(실행 아님) — import 대상이 없어도, env가 없어도 통과해야 한다.
 */

const DIR = path.join(process.cwd(), "scripts", "_classnote");

function workerScripts() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort();
}

describe("연동 PC 워커 스크립트", () => {
  it("검사 대상을 실제로 찾는다(0개면 통과가 무의미)", () => {
    expect(workerScripts().length).toBeGreaterThan(5);
  });

  it.each(workerScripts())("%s — 파스된다(문법 오류 없음)", (file) => {
    // `node --check`는 실행하지 않고 파싱만 한다 → 중복 선언·괄호 불일치 등을 잡는다.
    expect(() => execFileSync(process.execPath, ["--check", path.join(DIR, file)], { stdio: "pipe" })).not.toThrow();
  });
});
