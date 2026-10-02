/**
 * scripts/apply-all-alphas.ts  —  `pnpm db:alphas`
 *
 * alpha 마이그레이션(`000Na_*.sql`)과 Supabase CLI 타임스탬프 마이그레이션을 사전순으로 적용한다. 드리즐 스냅샷이
 * `0027`에 멈춰 있어(이후는 전부 alpha) 신규 테넌트 DB 프로비저닝이 ~50개 파일 수동 적용이었고,
 * 한 파일만 놓쳐도 RLS 정책 누락(= 전사 노출 위험) 가능성이 있었다(운영적합성 감사 B4).
 *
 * 신규 DB 셋업: `pnpm db:migrate`(드리즐 번호본) → `pnpm db:alphas`(이 스크립트).
 * alpha 파일은 멱등(IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE)이라 재실행 안전 —
 * 이미 적용된 객체의 "already exists"는 benign(skipped)으로 분류해 재실행이 깨끗이 수렴한다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — .env.local 확인.");
  process.exit(1);
}

const MIGRATIONS_DIR = "supabase/migrations";
// alpha + CLI 생성본. 드리즐 번호본(0000_…, 0027_…)은 db:migrate 담당.
const ALPHA = /^(?:\d{4}[a-z][a-z0-9_]*|\d{14}_[a-z0-9_]+)\.sql$/;

async function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => ALPHA.test(f))
    .sort();
  console.log(`alpha 마이그레이션 ${files.length}개 적용 (사전순, 멱등)…`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  try {
    for (const file of files) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await sql.unsafe(content);
        ok++;
        console.log(`  ✓ ${file}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate/i.test(msg)) {
          skipped++;
          console.log(`  ~ ${file} (이미 적용됨)`);
        } else {
          failed++;
          console.error(`  ✗ ${file}: ${msg}`);
        }
      }
    }
  } finally {
    await sql.end();
  }
  console.log(`완료: ${ok} 적용 / ${skipped} 이미적용 / ${failed} 실패 (총 ${files.length})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
