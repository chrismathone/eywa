/**
 * **SQL 시즌2 폴더 규칙** — 원장 2026-10-27 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔. 번호가 너무 많이 올랐어.
 * 다시 1번부터 시작할 수 있게"* · *"시즌2 sql 느낌으로 시작해 새로"*.
 *
 * `supabase/migrations/`에는 셋만 둔다: 시즌1 합본 `s1_season1.sql`(얼었다 — 고치지 않는다) · 시즌2 `s2_NNNN_설명.sql`(0001부터 빈틈없이) ·
 * `README.md`(적용 기록). 규약 밖 파일(옛 `NNNNa_` · CLI 타임스탬프 `20261027…_x.sql`)은 정렬 위치가 적용 순서를 보장하지 못해 막는다.
 * 🔴 다른 세션이 옛 규칙(`0459a_…`)으로 만들었으면 다음 빈 시즌2 번호로 바꿔 커밋한다(내용은 그대로).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasMigration, MIGRATIONS_DIR, migrationFiles, offConventionSql, readMigration, SEASON1_FILE, SEASON2_NAME, season1Sections, season2Names,
} from "./migrations-corpus.mjs";

/**
 * 🔴 시즌1 합본의 지문(줄끝 LF로 맞춘 sha256) — 합본은 운영에 이미 적용된 기록이라 **고치지 않는다**. 합본 전에 갈라진 브랜치의
 *    modify/delete 충돌을 합본 구역에 붙여 풀면 저장소만 바뀌고 운영은 그대로인 채 조용히 어긋난다(적대 리뷰 2026-10-27) —
 *    그 변경은 시즌2 파일로 옮긴다. 이 값을 바꾸는 커밋은 원장 승인이 있어야 한다.
 */
const SEASON1_SHA256 = "9328254a74564136f420befc47b63a3b071448374435ea44c4bcb24b49e05036";

const names = readdirSync(join(process.cwd(), MIGRATIONS_DIR));

describe("SQL 시즌2 — 폴더 규칙", () => {
  it("🔴 폴더에는 시즌1 합본 · 시즌2 파일 · README만 있다(옛 NNNNa_ · CLI 타임스탬프 이름 금지)", () => {
    const off = names.filter((f) => f !== SEASON1_FILE && f !== "README.md" && !SEASON2_NAME.test(f));
    expect(off, "새 SQL은 s2_NNNN_설명.sql(다음 빈 번호)로 — 옛 이름이면 바꿔서 커밋(방법: docs/sql-season2.md)").toEqual([]);
    // 규칙 밖 .sql이 하나라도 있으면 migrationFiles()가 던진다 — 그 SQL을 쓰는 가드·db:alphas가 모두 시끄럽게 실패한다.
    expect(offConventionSql()).toEqual([]);
  });

  it("🔴 시즌2 번호는 0001부터 빈틈·겹침 없이 이어진다", () => {
    const nums = season2Names().map((f) => Number(SEASON2_NAME.exec(f)![1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it("🔴 시즌1 합본은 얼었다 — 지문 고정 · 구역 568개 · 0000_fair_amazoness에서 0458a_makeup_reservation_checked까지(고치지 않는다)", () => {
    const text = readFileSync(join(process.cwd(), MIGRATIONS_DIR, SEASON1_FILE), "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(text, "utf8").digest("hex"), "시즌1 합본이 바뀌었다 — 바꿀 것은 시즌2 파일로(docs/sql-season2.md §3-B)").toBe(SEASON1_SHA256);
    const s1 = season1Sections();
    expect(s1.length).toBe(568);
    expect(s1[0]!.name).toBe("0000_fair_amazoness.sql");
    expect(s1.at(-1)!.name).toBe("0458a_makeup_reservation_checked.sql");
    expect(new Set(s1.map((s) => s.name)).size).toBe(568);
    // 구역 이름은 옛 규약(4자리 + 선택 접미) — 합본에 시즌2 이름이 섞이지 않는다.
    expect(s1.filter((s) => !/^\d{4}[a-z]?_[a-z0-9_]+\.sql$/.test(s.name))).toEqual([]);
  });

  it("원래 파일 이름으로 읽는다 — 시즌1 = 합본 구역 · 없는 이름은 던진다 · 적용 순서 = 시즌1 → 시즌2", () => {
    const body = readMigration("0458a_makeup_reservation_checked.sql");
    expect(body).toContain("add column if not exists checked_at timestamptz");
    expect(body).not.toContain("--@@s1 ");
    expect(hasMigration("0349a_makeup_legacy_guards.sql")).toBe(true);
    expect(hasMigration("0001a_rls_constraints_triggers.sql")).toBe(true);
    expect(hasMigration("0349a_none.sql")).toBe(false);
    expect(hasMigration("s2_9999_none.sql")).toBe(false);
    expect(() => readMigration("9999a_none.sql")).toThrow(/찾지 못했습니다/);
    const all = migrationFiles();
    expect(all.slice(0, 568).map((f) => f.name)).toEqual(season1Sections().map((s) => s.name));
    expect(all.slice(568).map((f) => f.name)).toEqual(season2Names());
  });
});
