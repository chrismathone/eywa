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

/**
 * `action:` 뒤의 **표현식 전체**를 잘라 낸다 — 괄호·중괄호 깊이를 세면서 depth 0의 `,`에서 끊는다.
 *
 * 🔴 2026-09-09: 종전엔 정규식이 **줄바꿈에서 끊겼다.** 그래서 자리 출결의 여러 줄 **중첩 삼항**
 *    (`seat_attendance_note` / `_clear` / `_set`)을 통째로 못 봤고, 세 키가 등록 없이 지나가
 *    원장 화면에 영문이 뜰 뻔했다. 가드가 못 보는 모양이 있으면 그건 가드가 아니다.
 */
function actionExprs(block: string): string[] {
  const out: string[] = [];
  let k = 0;
  while ((k = block.indexOf("action:", k)) !== -1) {
    let d = 0;
    let q: string | null = null;
    let e = k + "action:".length;
    for (; e < block.length; e++) {
      const c = block[e];
      if (q) {
        if (c === String.fromCharCode(92)) e++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") {
        if (d === 0) break;
        d--;
      } else if (c === "," && d === 0) break;
    }
    out.push(block.slice(k + "action:".length, e));
    k = e;
  }
  return out;
}

/** logAction( … )(·logSeatAction·logActionAs·logActionAtDoor) 호출 블록에서 action 문자열 리터럴을 뽑는다(삼항 `a ? "x" : "y"` 포함). */
function usedActions(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of tsFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    // 🔴 감싼 헬퍼(`logSeatAction(g, seat, {…})`·`logActionAs(actor, {…})`·`logActionAtDoor(door, {…})`)도 같은 액션 키를 싣는다 —
    //    `logAction(`만 찾으면 그 호출부가 통째로 스캔 밖으로 빠져 미등록 키가 조용히 샌다
    //    (2026-09-10 자리 PIN 감사 도입 때 자리 출결 3곳이 그렇게 빠질 뻔했다).
    //    ⚠️ 이름을 **정확히** 적는다 — `log…Action…(`으로 넓히면 `logSuperAdminAction(`처럼 **다른 표**에
    //    쓰는 로거까지 잡혀 거짓 '미등록'이 뜬다(그 키들은 audit_logs 레지스트리 대상이 아니다).
    if (!/\blog(?:Seat)?Action(?:As|AtDoor)?\(|\blogPlanChange\(/.test(src)) continue;
    for (const call of src.matchAll(/\blog(?:Seat)?Action(?:As|AtDoor)?\(/g)) {
      const i = call.index;
      let j = i + call[0].length;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      for (const expr0 of actionExprs(src.slice(i, j))) {
        const m = [expr0, expr0] as const;
        // 🔴 **비교 피연산자는 액션이 아니다** — `action: kind === "rotate" ? "a_create" : "a_toggle"`처럼
        //    삼항의 **조건**에 문자열이 있으면 그것까지 액션으로 오인해 "미등록"이라 오탐한다
        //    (2026-08-07 실제 발생: intake-token-actions의 "rotate"로 main이 빨개졌다. 실제 기록값은
        //    staff_intake_token_create로 정상 등록돼 있었고 화면엔 아무 문제가 없었다).
        //    ⚠️ 가드를 느슨하게 하는 게 아니다 — **기록되는 값**(? 뒤의 분기)은 그대로 전부 검사한다.
        const expr = m[1].replace(/[=!]==?\s*"[^"]*"/g, "");
        for (const q of expr.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
          const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
          if (!found.has(q[1])) found.set(q[1], new Set());
          found.get(q[1])!.add(rel);
        }
      }
    }
    // `logPlanChange("ecs_plan_line_add", grant, …)`처럼 **첫 인자로 키를 넘기는** 감싼 헬퍼도 본다 —
    // 안 보면 진도 줄 감사 키 4종이 미등록인 채로 감사 화면에 영문 키를 냈다(적대적 리뷰 2026-09-10).
    for (const pm of src.matchAll(/\blogPlanChange\(\s*"([a-z][a-z0-9_]*)"/g)) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      if (!found.has(pm[1])) found.set(pm[1], new Set());
      found.get(pm[1])!.add(rel);
    }
  }
  return found;
}

/**
 * 🔴 운영 스크립트는 서버 액션이 아니라 **PostgREST로 audit_logs에 직접 POST**한다 — 위 `logAction(` 스캔이
 * 아예 못 본다. 그래서 `staff_create`가 라벨 없이 새어(2026-08-20 원장 화면에 영문 그대로) 있었다.
 * audit_logs를 건드리는 스크립트 파일만 골라 `action: "…"` 리터럴을 같은 레지스트리에 물린다.
 */
function scriptFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "logs") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scriptFiles(p, out);
    else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scriptActions(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of scriptFiles(path.join(process.cwd(), "scripts"))) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("audit_logs")) continue;
    for (const m of src.matchAll(/action:\s*"([a-z][a-z0-9_]*)"/g)) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1])!.add(rel);
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

  it("🔴 scripts/가 audit_logs에 직접 POST하는 액션도 AUDIT_ACTIONS에 등록돼 있다", () => {
    const scanned = scriptActions();
    // 스캔이 실제로 동작하는지 먼저(0건이면 통과가 무의미 — 위 logAction 스캔과 같은 자기검증).
    expect(scanned.size, "scripts/에서 audit_logs POST를 하나도 못 찾음 — 스캔 방식을 갱신할 것").toBeGreaterThan(0);
    const registry = registryKeys();
    const missing = [...scanned]
      .filter(([key]) => !registry.has(key))
      .map(([key, files]) => `${key}  ←  ${[...files].join(", ")}`);
    expect(
      missing,
      `AUDIT_ACTIONS 미등록 액션(스크립트 경로) — 감사로그 '액션' 열에 영문 키가 그대로 노출된다:\n  ${missing.join("\n  ")}`,
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

/**
 * '대상' 열 접두(target_type)도 같은 뿌리로 샜다 — 2026-08-17엔 attendance 등 5종, 2026-08-20엔
 * calendar_event·calendar_tag가 라벨 없이 영문으로 떠 있었다(describe.test.ts의 수기 목록은 사람이
 * 갱신해야 해서 늘 늦는다). 호출부를 **전수 스캔**해 AUDIT_TYPE_LABEL과 맞춘다.
 */
describe("감사로그 대상 유형 라벨", () => {
  const DESCRIBE_TS = path.join(SRC, "features", "audit", "describe.ts");

  function labelKeys(): Set<string> {
    const src = fs.readFileSync(DESCRIBE_TS, "utf8");
    const start = src.indexOf("export const AUDIT_TYPE_LABEL: Record<string, string> = {");
    expect(start, "AUDIT_TYPE_LABEL 선언을 찾지 못함 — 스캔 방식을 갱신할 것").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("};", start));
    return new Set([...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
  }

  it("logAction·스크립트가 쓰는 모든 target_type이 한글 라벨을 가진다", () => {
    const used = new Map<string, string>();
    for (const file of tsFiles(SRC)) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/targetType:\s*"([a-z_]+)"/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(process.cwd(), file).split(path.sep).join("/"));
      }
    }
    for (const file of scriptFiles(path.join(process.cwd(), "scripts"))) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes("audit_logs")) continue;
      for (const m of src.matchAll(/target_type:\s*"([a-z_]+)"/g)) {
        if (!used.has(m[1])) used.set(m[1], path.relative(process.cwd(), file).split(path.sep).join("/"));
      }
    }
    expect(used.size, "target_type을 하나도 못 찾음 — 스캔 방식을 갱신할 것").toBeGreaterThan(10);
    const labels = labelKeys();
    const missing = [...used].filter(([t]) => !labels.has(t)).map(([t, f]) => `${t}  ←  ${f}`);
    expect(
      missing,
      `AUDIT_TYPE_LABEL 미등록 대상 유형 — 감사로그 '대상' 열에 영문이 그대로 노출된다:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

/**
 * 한글화 함수를 만들어 두고 **뷰어가 안 쓰면** 화면은 그대로 영문이다(#77의 결). 네 열이 각각
 * 자기 매핑을 통과하는지 소스로 잠근다 — 다음 사람이 열을 새로 짜도 여기서 걸린다.
 */
describe("감사로그 뷰어 배선", () => {
  const FACE = path.join(SRC, "app", "(shell)", "owner", "_components", "audit-face.tsx");

  it("실행자·액션·대상·상세 네 열이 전부 한글 매핑을 거친다", () => {
    const src = fs.readFileSync(FACE, "utf8");
    for (const fn of ["auditActorName(", "auditActionLabel(", "auditTargetLabel(", "auditDetail("]) {
      expect(src, `${fn} 미배선 — 그 열은 DB 원문이 그대로 노출된다`).toContain(fn);
    }
  });

  it("🔴 raw 원문(actorName·targetLabel)은 매핑을 거치거나 title 툴팁으로만 쓴다", () => {
    // 원문 보존은 title 툴팁의 몫이라 title= 안은 제외하고 본다 — 나머지 자리에서 원문이 쓰이면
    // 그건 곧 화면 렌더다(종전: {log.actorName ?? "—"} / {log.targetLabel ?? …}).
    const stripped = fs.readFileSync(FACE, "utf8").replace(/title=\{[^{}]*\}/g, "");
    const count = (re: RegExp) => [...stripped.matchAll(re)].length;
    expect(count(/log\.actorName/g), "actorName이 auditActorName 밖에서 쓰인다").toBe(
      count(/auditActorName\(log\.actorName\)/g),
    );
    expect(count(/log\.targetLabel/g), "targetLabel이 auditTargetLabel 밖에서 쓰인다").toBe(
      count(/auditTargetLabel\(log\.targetType, log\.targetLabel,/g),
    );
  });
});
