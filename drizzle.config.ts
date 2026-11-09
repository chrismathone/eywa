import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// 🔴 2026-11-09: DB에 쓰는 drizzle-kit 명령(push·migrate)과 로컬 마이그레이션을 바꾸는 명령(up·drop)은 막는다. 이 설정은 `.env.local`의 DATABASE_URL(운영 DB)을
//    가리키고, drizzle은 시즌1 SQL의 RLS·트리거·함수를 몰라 push가 삭제를 제안할 수 있다. `pnpm db:push`만 막으면
//    `npx drizzle-kit push`로 그대로 우회된다. generate·studio·check는 그대로 쓴다. 운영 DB 변경은 s2_NNNN 파일로만(docs/sql-season2.md).
const BLOCKED_COMMANDS = new Set(["push", "migrate", "up", "drop"]);
// 명령 자리(drizzle-kit은 명령이 맨 앞)만 본다 — `generate --name drop`처럼 옵션 값이 같은 글자여도 막지 않는다.
const command = process.argv[2];
const blocked = command && BLOCKED_COMMANDS.has(command) ? command : undefined;
if (blocked) {
  console.error(`drizzle-kit ${blocked}는 쓰지 않습니다 — 운영 DB에는 새 s2_NNNN 파일 하나만 원장 승인 뒤 적용 · 새(빈) DB 셋업은 pnpm db:alphas`);
  process.exit(1);
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  // 2026-10-27 시즌2: supabase/migrations는 시즌1 합본 + `s2_NNNN_*.sql`만 둔다(폴더 규칙 가드) — drizzle 생성물은 따로 받아
  // 필요한 문장만 다음 시즌2 파일로 옮겨 쓴다. 저널·스냅샷은 지웠다(git 기록에만) — generate는 스키마 전체를 처음부터 만든다(참고용).
  out: "./supabase/drizzle-out",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
