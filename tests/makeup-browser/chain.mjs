/** Apply actual Drizzle journal then alpha files on an empty owned LOCAL DB; never reads env files. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { migrationFiles, readMigration } from "../../src/lib/db/migrations-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("Synthetic chain evidence JSON path required");
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_chain",
  username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {}, prepare: false });
const read = rel => readFile(path.join(root, rel), "utf8");
const results = [];
try {
  assert.equal((await db`select current_database() as name`)[0].name, "makeup_chain");
  await db.unsafe("drop schema if exists makeup_private cascade; drop schema if exists tm_sync_private cascade; drop schema if exists vault cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema public cascade; create schema public;");
  await db.unsafe(await read("tests/makeup-browser/chain-platform.sql"));
  // 적용 순서 = 시즌1 합본 구역(drizzle 번호본 0000~0027 → alpha) → 시즌2 파일(2026-10-27 시즌2 — 낱개 파일은 합본 구역이 됐고 저널은 지웠다 · 번호본 = 이름에 접미 글자가 없는 구역).
  const chain = migrationFiles().map(file => file.name);
  const base = chain.filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file));
  const alpha = chain.filter(file => !base.includes(file));
  for (const file of [...base, ...alpha]) {
    try {
      // Real journal statement breakpoints preserve its individual statement boundaries.
      const source = readMigration(file);
      if (base.includes(file)) for (const statement of source.split("--> statement-breakpoint")) {
        if (statement.trim()) await db.unsafe(statement);
      }
      else await db.unsafe(source);
      results.push({ file, status: "applied" });
    } catch (error) {
      await db.unsafe("rollback");
      const status = /already exists|duplicate/i.test(error.message) ? "existing_baseline" : "failed";
      results.push({ file, status, message: error.message, code: error.code });
      console.log(`${status.toUpperCase()} ${file}: ${error.message}`);
    }
  }
  // Historical alpha files reference helpers defined later. Replay those failures after prerequisites exist.
  for (const result of results.filter(result => result.status === "failed")) {
    try {
      await db.unsafe(readMigration(result.file));
      result.firstFailure = result.message; result.status = "applied_after_prerequisite";
      delete result.message;
    } catch (error) { await db.unsafe("rollback"); result.message = error.message; }
  }
  const newFiles = results.filter(result => /^(?:034[3-9]|0350)[a-z]_makeup_/.test(result.file));
  const failures = results.filter(result => result.status === "failed");
  const summary = { boundary: "Actual app migration chain; synthetic Supabase auth/storage platform; owned makeup_chain DB only",
    base: base.length, alpha: alpha.length, newApplied: newFiles.filter(result => result.status === "applied").length,
    newTotal: newFiles.length, failures, results };
  await writeFile(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ base: summary.base, alpha: summary.alpha, newApplied: summary.newApplied, newTotal: summary.newTotal, failures: failures.length }));
  assert.ok(newFiles.length > 0 && newFiles.every(result => result.status === "applied"), "New feature migrations must all apply on actual base chain");
  if (failures.length) process.exitCode = 2; // Preserve baseline gaps; never label a partially applied chain complete.
} finally { await db.end(); }
