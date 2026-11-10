import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 가드 — **`src/` 안에서 `tenant_settings`를 UPDATE하는 곳**의 두 규칙(2026-10-05, settings-stamp.ts).
 *
 * ① 전부 `updated_at`을 함께, 직전 값과 다른 값으로 쓴다 — 화면 저장(`saveOwnerSection`)이 "읽은 뒤 문서가 바뀌었나"를
 *    이 값으로 본다. 갱신하지 않으면 화면 저장이 그 변경을 못 보고 자기가 읽어 둔 문서로 덮는다(cron·시트 반영·데모 구성이 그랬다).
 * ② **운영 · 역할·권한 섹션을 다시 쓰는** 앱 저장은 그 섹션의 저장 순번(`data.<섹션>.rev`)을 올린다 — 편집 폼이 "내려온 값이
 *    내 저장보다 먼저 읽힌 것인가"를 가리는 순서다. 한 칸만 고치는 SQL(`jsonb_set`)은 순번을 그대로 둔다(줄이지 않으면 된다).
 *    🔴 순번을 문서 최상위에 두지 않는다 — DB의 쓰기 가드(0335a)가 개별 설정만 위임받은 사람의 저장을 전부 거절하게 된다.
 * 새 writer를 만들면 아래 목록에 올리고 같은 규칙을 지킬 것.
 * ⚠️ DB 함수(RPC) 안의 쓰기와 운영자가 손으로 돌리는 `scripts/`는 이 가드가 보지 못한다. 그쪽은 순번을 올리지 않아도 되지만
 *    **줄이면 안 된다**(읽어 둔 문서를 통째로 되써서 옛 순번을 넣지 말 것) — 설정 저장·cron과 동시에 돌리지 않는다는 전제도 그대로다.
 */
const SRC = join(process.cwd(), "src");
const WRITERS = [
  "features/demo-roster/dashboard-apply.ts",
  "features/demo-roster/demo-weekday.ts",
  "features/owner/server/actions.ts",
  // 퇴사자 권한 정리(2026-11-09) — 그 사람 줄만 빼고 updated_at 비교 · permissions.rev + 1.
  "features/owner/server/retired-people.ts",
  "features/owner/server/scheduled-groups.ts",
  "features/owner/server/setting-role-actions.ts",
  "features/timetable/server/master-sheet-store.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** raw SQL `update tenant_settings …` 또는 supabase-js `.from("tenant_settings")…update(` — 문장 단위로 뽑는다. */
function updateStatements(code: string): string[] {
  const sql = [...code.matchAll(/update\s+tenant_settings\b[\s\S]*?(?:`|where\s+tenant_id)/gi)].map((m) => m[0]);
  const client = [...code.matchAll(/\.from\("tenant_settings"\)\s*\.update\(([\s\S]*?)\)\s*\.eq\(/g)].map((m) => m[0]);
  return [...sql, ...client];
}

describe("tenant_settings writer는 수정 표식을 갱신한다", () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join("/"), code: strip(readFileSync(path, "utf8")) }));
  const writers = files.filter((f) => updateStatements(f.code).length > 0 || /\.from\("tenant_settings"\)[\s\S]{0,40}\.update\(/.test(f.code));

  it("UPDATE하는 파일 목록이 이 가드가 아는 것과 같다 — 새 writer는 여기에 올린다", () => {
    expect(writers.map((f) => f.path).sort()).toEqual(WRITERS);
  });

  it.each(WRITERS)("%s — 모든 UPDATE가 updated_at을 함께 쓴다", (path) => {
    const file = files.find((f) => f.path === path)!;
    const statements = updateStatements(file.code);
    // actions.ts는 `update(write)`로 객체를 넘긴다 — 그 객체에 updated_at이 있는지 본다.
    if (path === "features/owner/server/actions.ts") {
      expect(file.code).toMatch(/const write = \{[\s\S]*?updated_at: nextSettingsStamp\(existing\?\.updated_at\),[\s\S]*?\};/);
      expect(file.code).toMatch(/\.update\(write\)\.eq\("tenant_id", actor\.tenantId\)\.eq\("updated_at", existing\.updated_at\)/);
      return;
    }
    expect(statements.length).toBeGreaterThan(0);
    // 지금 시각을 그대로 쓰지 않는다 — 직전 값보다 반드시 뒤로.
    const forward = /updated_at\s*=\s*greatest\(now\(\), updated_at \+ interval '1 millisecond'\)|updated_at: nextSettingsStamp\(row\.updated_at\)/;
    for (const statement of statements) expect(statement).toMatch(forward);
  });

  it("🔴 운영 · 역할·권한 섹션을 다시 쓰는 앱 저장은 그 섹션의 저장 순번을 올린다 — 문서 최상위에는 두지 않는다", () => {
    const code = (path: string) => files.find((f) => f.path === path)!.code;
    // 중앙 저장: 순번을 쓰는 섹션은 이 둘이고, 올리는 값은 **그 섹션의** 직전 순번 + 1이다.
    expect(code("features/owner/server/actions.ts")).toMatch(/const REV_SECTIONS: readonly SectionKey\[\] = \["operations", "permissions"\];/);
    expect(code("features/owner/server/actions.ts")).toMatch(
      /const sectionRev = REV_SECTIONS\.includes\(section\) \? settingsRevOf\(base\[section\]\) \+ 1 : undefined;/,
    );
    expect(code("features/owner/server/scheduled-groups.ts")).toMatch(/rev: settingsRevOf\(storedOperations\) \+ 1/);
    // 최상위에 순번을 쓰는 코드가 없다(DB 쓰기 가드와 충돌한다) — 문서를 펼친 바로 그 층에는 `rev`가 없다.
    expect(code("features/owner/server/actions.ts")).toMatch(/const nextData: Record<string, unknown> = \{ \.\.\.base, version: 1, \[section\]: storedSection \};/);
    expect(code("features/owner/server/scheduled-groups.ts")).toMatch(
      /const nextData = \{\s*\.\.\.\(data \?\? \{\}\),\s*operations: \{ \.\.\.storedOperations, rev: settingsRevOf\(storedOperations\) \+ 1, subjects: nextSubjects \},\s*\};/,
    );
    // 퇴사자 권한 정리: 역할·권한 섹션 안의 순번을 올리고, 읽은 그대로일 때만 쓴다(0행 = 다시 읽기).
    expect(code("features/owner/server/retired-people.ts")).toMatch(/permissions: \{ \.\.\.\(next\.permissions as Record<string, unknown>\), rev: settingsRevOf\(/);
    expect(code("features/owner/server/retired-people.ts")).toMatch(/\.eq\("tenant_id", tenantId\)\.eq\("updated_at", row\.updated_at\)\.select\("tenant_id"\)/);
    // '역할 설정' 대화상자: 역할·권한 섹션을 다시 쓰므로 그 섹션 안의 순번을 올린다(문서 최상위가 아니다).
    expect(code("features/owner/server/setting-role-actions.ts")).toMatch(
      /const next = \{ \.\.\.row\.data, permissions: \{ \.\.\.row\.data\.permissions, overrides, rev: settingsRevOf\(row\.data\.permissions\) \+ 1 \} \};/,
    );
  });

  it("한 칸만 고치는 SQL은 문서의 다른 칸(저장 순번 포함)을 그대로 둔다 — `data`를 통째로 갈아끼우지 않는다", () => {
    for (const path of ["features/demo-roster/dashboard-apply.ts", "features/demo-roster/demo-weekday.ts", "features/timetable/server/master-sheet-store.ts"]) {
      const statements = updateStatements(files.find((f) => f.path === path)!.code);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) expect(statement).toMatch(/data\s*=\s*jsonb_set\(/);
    }
  });

  it("cron 반영은 읽은 그대로일 때만 쓰고, 0행도 충돌로 본다", () => {
    const code = files.find((f) => f.path === "features/owner/server/scheduled-groups.ts")!.code;
    expect(code).toMatch(/\.select\("data, updated_at"\)/);
    expect(code).toMatch(/\.eq\("updated_at", row\.updated_at\)\s*\.select\("tenant_id"\)/);
    expect(code).toMatch(/if \(!written\?\.length\) return "conflict";/);
  });
});
