/**
 * scripts/apply-all-alphas.ts  —  `pnpm db:alphas` (새 DB 전용 · `pnpm db:migrate`는 안내만 하고 멈춘다)
 *
 * **새 DB 하나를 처음부터 세운다** — 시즌1 합본 `supabase/migrations/s1_season1.sql`의 구역(drizzle 번호본 0000~0027 → alpha
 * 0001a~0458a, 낱개 시절 `db:migrate` → `db:alphas`와 같은 순서)을 **구역마다 따로** 적용하고, 이어서 시즌2 `s2_NNNN_*.sql`을
 * 이름순으로 적용한다(2026-10-27 시즌2 — 원장 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔"*).
 * 낱개 시절처럼 구역 하나가 실패해도 다음 구역으로 간다 — 이미 있는 객체의 "already exists"는 benign(skipped)으로 센다.
 * 첫 바퀴에서 실패가 있으면 **첫 실패 구역부터 끝까지 전부** 순서대로 한 번 더 돌린다 — 옛 파일 몇은 뒤 번호가 만드는 함수·표가
 * 있어야 돈다(예: 0366a·0367a → 0415a · 0379a·0380a → 0405a·0415a). 🔴 실패한 것만 끝에서 다시 돌리면 그 옛 정의가 **맨 마지막**에
 * 앉아 뒤 구역의 새 정의(0441a `staff_tasks_sync` 등)를 덮는다(적대 리뷰 2026-10-27) — 그래서 그 뒤 구역까지 다시 돌려 마지막 정의를 되찾는다.
 * 낱개 시절엔 `db:alphas`를 한 번 더 치면 전체가 다시 돌아 맞춰졌다 — 이제 빈 DB 확인 때문에 두 번째 실행이 멈추므로 스크립트 안에서 마무리한다.
 * 🔴 **빈 DB에서만 돈다** — `public.tenants`가 이미 있으면 아무것도 하지 않고 멈춘다(적대 리뷰 2026-10-27: 운영 DB에 돌면 시즌1
 *    구역의 데이터 보정 update와 옛 함수 정의까지 다시 돈다). 운영은 시즌1이 모두 적용돼 있고, 새 시즌2 파일 하나만 원장 승인 뒤 따로 적용한다.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { migrationFiles } from "../src/lib/db/migrations-corpus.mjs";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — .env.local 확인.");
  process.exit(1);
}

async function main() {
  // 적용 순서 = 시즌1 합본 구역 → 시즌2 파일(이름순). 원래 파일 이름 그대로 보고한다.
  const files = migrationFiles();
  console.log(`마이그레이션 ${files.length}개 적용 (시즌1 구역 → 시즌2, 멱등)…`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const [{ seeded }] = await sql<{ seeded: boolean }[]>`select to_regclass('public.tenants') is not null as seeded`;
  if (seeded) {
    await sql.end();
    console.error("이 DB에는 이미 스키마가 있습니다(public.tenants) — 새(빈) DB 전용입니다. 운영·개발 DB에는 새 s2_NNNN 파일 하나만 적용하세요.");
    process.exit(1);
  }
  let ok = 0;
  let skipped = 0;
  const retry = new Map<string, string>(); // 첫 바퀴 실패 → 그때 오류
  const failures: string[] = [];
  let rerun = 0; // 둘째 바퀴에서 다시 돈 구역 수
  try {
    for (const { name: file, sql: content } of files) {
      try {
        await sql.unsafe(content);
        ok++;
        console.log(`  ✓ ${file}`);
      } catch (e) {
        // 구역 안에 begin이 있으면 연결이 '중단된 거래'로 남는다 — 되돌려야 다음 구역이 돈다(tests/makeup-browser/chain.mjs와 같다).
        await sql.unsafe("rollback").catch(() => {});
        const msg = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate/i.test(msg)) {
          skipped++;
          console.log(`  ~ ${file} (이미 적용됨)`);
        } else {
          retry.set(file, msg);
          console.log(`  … ${file}: ${msg} (둘째 바퀴에서 다시)`);
        }
      }
    }
    // 둘째 바퀴 — 뒤 구역이 만든 함수·표가 생겼으니 **첫 실패 구역부터 끝까지** 순서대로 다시(마지막 정의가 제자리로 돌아오게).
    const from = retry.size ? files.findIndex((f) => retry.has(f.name)) : files.length;
    rerun = files.length - from;
    for (const { name: file, sql: content } of files.slice(from)) {
      try {
        await sql.unsafe(content);
        if (retry.has(file)) {
          ok++;
          console.log(`  ✓ ${file} (둘째 바퀴 — 처음엔: ${retry.get(file)!.slice(0, 80)})`);
        }
      } catch (e) {
        await sql.unsafe("rollback").catch(() => {});
        const again = e instanceof Error ? e.message : String(e);
        if (/already exists|duplicate/i.test(again)) {
          if (retry.has(file)) {
            skipped++;
            console.log(`  ~ ${file} (둘째 바퀴 · 이미 적용됨)`);
          }
        } else {
          failures.push(file);
          console.error(`  ✗ ${file}: ${again}`);
        }
      }
    }
  } finally {
    await sql.end();
  }
  console.log(`완료: ${ok} 적용 / ${skipped} 이미적용 / ${failures.length} 실패 (총 ${files.length} · 둘째 바퀴 ${rerun}구역 — 첫 실패 ${retry.size})`);
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
