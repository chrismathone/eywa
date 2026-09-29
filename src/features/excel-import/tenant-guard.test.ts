import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 지점 분리 가드 — 원장 2026-09-29 *"엑셀 업로드시에 지점 분리되서 db 잘 적용되는거 맞지? 다른 지점 영향 없이 가드 철저하게"*.
 *
 * 엑셀 가져오기는 한 번에 수백 줄을 쓰고, 일부는 RLS를 우회하는 admin 클라이언트를 쓴다(직원 계정·캘린더·셔틀·교재).
 * 그래서 **문장 하나하나가 제 지점만 건드리는지**를 코드 모양으로 잠근다:
 *  ① 지점은 **세션에서만** 온다 — 올린 파일·폼 값으로 지점을 바꿀 길이 없다.
 *  ② 고치기(update)·지우기(delete)는 전부 `tenant_id` 조건을 단다(RLS가 있든 없든).
 *  ③ 넣기(insert·upsert)는 전부 `tenant_id: ctx.tenantId`를 싣는다.
 *  ④ admin 클라이언트의 읽기는 전부 `tenant_id`로 거른다(남의 지점 원생·반을 이름으로 찾아 잇지 않게).
 */
const ROOT = join(__dirname, "..", "..", "..");
const DIR = join(ROOT, "src/features/excel-import/importers");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({ name: f, src: readFileSync(join(DIR, f), "utf8") }));

/**
 * `.method(` 한 문장 — 그 줄 머리부터, 괄호 짝을 맞춰 **체인이 끝나는 곳**까지(`.eq(…)`가 이어지는 동안).
 * `;`로 자르면 인자 안의 화살표 함수 본문(`const status = …;`)에서 끊겨 헛경보가 난다.
 */
function statementsWith(src: string, method: RegExp): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  for (const m of src.matchAll(method)) {
    const at = m.index ?? 0;
    const start = src.lastIndexOf("\n", at);
    let i = at + m[0].length; // '(' 바로 뒤
    let depth = 1;
    for (;;) {
      while (i < src.length && depth > 0) {
        const c = src[i++];
        if (c === "(") depth++;
        else if (c === ")") depth--;
      }
      // 체인이 이어지면(`.eq(` · `.select(` …) 다음 괄호까지 먹는다.
      const next = /^\s*\.(\w+)\(/.exec(src.slice(i));
      if (!next) break;
      i += next[0].length;
      depth = 1;
    }
    out.push({ at: src.slice(0, at).split("\n").length, text: src.slice(start, i) });
  }
  return out;
}

describe("엑셀 가져오기 — 지점 분리", () => {
  it("① 지점은 세션에서만 — 실행기·주소가 폼 값으로 지점을 받지 않는다", () => {
    const run = readFileSync(join(ROOT, "src/features/excel-import/server/run.ts"), "utf8");
    const route = readFileSync(join(ROOT, "src/app/api/excel-import/[kind]/route.ts"), "utf8");
    expect(run).toContain("return { user, tenantId: user.tenantId };");
    for (const src of [run, route]) expect(src).not.toMatch(/get\(["']tenant/i);
    for (const f of files) expect(f.src, f.name).not.toMatch(/get\(["']tenant/i);
  });

  it("② update·delete는 전부 tenant_id 조건", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of statementsWith(f.src, /\.(update|delete)\(/g)) {
        if (!/\.eq\("tenant_id"/.test(s.text)) bad.push(`${f.name}:${s.at}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("③ insert·upsert는 전부 tenant_id를 싣는다", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of statementsWith(f.src, /\.(insert|upsert)\(/g)) {
        // 줄을 따로 만들어 넘기는 경우(`insert(chunk)`)는 그 파일이 행을 만들 때 지점을 싣는지로 본다.
        const inline = /tenant_id: ctx\.tenantId/.test(s.text);
        const viaVar = !inline && /\.(insert|upsert)\((rows|chunk)\b/.test(s.text) && /tenant_id: ctx\.tenantId/.test(f.src);
        if (!inline && !viaVar) bad.push(`${f.name}:${s.at}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("④ admin 클라이언트의 읽기는 전부 tenant_id로 거른다", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of statementsWith(f.src, /admin\s*\.from\([^)]*\)\s*\.select\(/g)) {
        if (!/\.eq\("tenant_id"/.test(s.text)) bad.push(`${f.name}:${s.at}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("⑤ 새 직원 계정은 올린 사람의 지점으로만 만들어진다", () => {
    const staff = files.find((f) => f.name === "staff.ts")!.src;
    expect(staff).toContain("app_metadata: { tenant_id: ctx.tenantId");
  });
});
