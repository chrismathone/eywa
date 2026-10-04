import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import { expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

/** 실제 DB의 역할 권한·Vault·동시 저장·기존 영상 처리를 한 번의 전체 롤백으로 검증한다. */
it.skipIf(!process.env.DATABASE_URL)("Drive 계정은 지점·폴더에 고정되고 OAuth 재생·계정 우회·옛 워커를 차단한다", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/check-homework-video-drive-accounts.cjs"], {
    env: process.env, timeout: 25_000, maxBuffer: 64 * 1024,
  });
  const result = JSON.parse(stdout.trim());
  expect(result.checks).toBeGreaterThanOrEqual(28);
  expect(result.rolledBack).toBe(true);
  expect(result.videosAfter).toBe(result.videosBefore);
});
