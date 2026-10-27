import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

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
