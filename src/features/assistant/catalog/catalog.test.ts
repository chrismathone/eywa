// 학원 비서 DB 지도 가드 — "하나도 빠짐없이"(원장 2026-11-06)를 시험이 지킨다.
// 기준 = 마이그레이션 원문(시즌1 합본 + 시즌2)에서 만들어지고 지워지지 않은 public 표. 새 표를 만들면 설명 한 줄이 필요하다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrationFiles } from "@/lib/db/migrations-corpus.mjs";
import { ASSISTANT_DOCS, ONTOLOGY_DOCS } from ".";
import { AUTO_CONTRIBUTION_FACTORS } from "./tables-extra";

function liveTables(): Set<string> {
  const created = new Set<string>();
  for (const { sql: raw } of migrationFiles() as Array<{ name: string; sql: string }>) {
    const sql = raw.replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) created.add(m[1]!.toLowerCase());
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) created.delete(m[1]!.toLowerCase());
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      if (created.delete(m[1]!.toLowerCase())) created.add(m[2]!.toLowerCase());
    }
  }
  return created;
}

/** SQL의 제외 표(assistant_private.excluded_tables) — 보기가 없으니 설명도 필요 없다. */
function excludedInSql(): string[] {
  const sql = migrationFiles()
    .filter((f: { name: string }) => /academy_assistant/.test(f.name))
    .map((f: { sql: string }) => f.sql)
    .join("\n");
  const block = sql.slice(sql.indexOf("insert into assistant_private.excluded_tables"), sql.indexOf("on conflict (table_name) do update set reason"));
  return [...block.matchAll(/\('([a-z_]+)',/g)].map((m) => m[1]!);
}

describe("학원 비서 DB 지도", () => {
  const live = liveTables();
  const excluded = excludedInSql();
  const docs = new Map(ASSISTANT_DOCS.map((d) => [d.name, d]));

  it("마이그레이션에서 표를 실제로 찾았다(빈 집합으로 통과하지 않게)", () => {
    expect(live.size).toBeGreaterThan(250);
    expect(excluded).toEqual(expect.arrayContaining(["assistant_threads", "assistant_messages", "assistant_conversations"]));
  });

  it("🔴 비서가 읽는 표는 하나도 빠짐없이 설명이 있다(새 표 = tables-a/b/extra에 한 줄)", () => {
    const missing = [...live].filter((t) => !excluded.includes(t) && !docs.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("설명은 있는 표에만(오타 · 지운 표) · 이름은 한 번씩", () => {
    const names = ASSISTANT_DOCS.map((d) => d.name);
    expect(names.length).toBe(new Set(names).size);
    const onto = new Set(ONTOLOGY_DOCS.map((d) => d.name));
    expect(names.filter((n) => !onto.has(n) && !live.has(n))).toEqual([]);
  });

  it("진행 단계 칩 이름(label)은 짧은 한국어 · 설명(ko)은 한 줄", () => {
    const bad = ASSISTANT_DOCS.filter((d) => !d.label || d.label.length > 12 || !/[가-힣]/.test(d.label) || !d.ko || d.ko.length > 120 || d.ko.includes("\n"));
    expect(bad.map((d) => `${d.name}: ${d.label} / ${d.ko}`)).toEqual([]);
  });

  it("온톨로지 보기는 SQL(§6)이 만드는 이름과 같다", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/s2_0031_academy_assistant.sql"), "utf8");
    const views = [...sql.matchAll(/create view assistant\.(onto_[a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(views)).toEqual(new Set(ONTOLOGY_DOCS.map((d) => d.name)));
  });
});

describe("온톨로지 자리 라벨 = 앱 별칭(teacher-label.ts)", () => {
  it("자리 교시 별칭이 앱과 같다 — 별칭이 늘면 온톨로지·class_schedules 설명도 함께(적대 리뷰 2026-11-06)", async () => {
    const { SPECIAL_SLOT_ALIAS_KEYS } = await import("@/features/timetable/lib/teacher-label");
    const { ONTOLOGY_MAP } = await import("./ontology");
    const notes = ASSISTANT_DOCS.find((d) => d.name === "class_schedules")?.notes ?? "";
    const listed = (text: string) => [...(text.match(/in \(('[^)]*')\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(listed(ONTOLOGY_MAP)).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
    expect(listed(notes)).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
  });

  it("기여도 요인 — 앱이 자동 계산하는 번호 목록이 factor-query.ts와 같다(어긋나면 비서가 화면에 있는 값을 '기록 없음'이라 한다)", () => {
    const src = readFileSync(join(process.cwd(), "src/features/student-contribution/server/factor-query.ts"), "utf8");
    const ids = [...new Set([...src.matchAll(/\bput\("(F\d\d)"/g)].map((m) => m[1]!))].sort();
    expect(ids.length).toBeGreaterThan(0);
    expect([...AUTO_CONTRIBUTION_FACTORS].sort()).toEqual(ids);
  });
});
