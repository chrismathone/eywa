import os from "node:os";
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import { videoWorkerReadiness } from "./video-worker-readiness.mjs";

const option = (key) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const hostname = option("host") || os.hostname();
const startedAfter = option("started-after");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
try {
  if (startedAfter && !Number.isFinite(Date.parse(startedAfter))) throw new Error("invalid-date");
  const tenant = await resolveTenant(sql);
  const deadline = Date.now() + (process.argv.includes("--wait") ? 60_000 : 0);
  let result;
  do {
    const [row] = await sql`select last_seen,started_at,last_results from classnote_workers
      where tenant_id=${tenant} and hostname=${hostname}`;
    result = videoWorkerReadiness(row, { folderId: process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID, startedAfter });
    if (result.ready || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  } while (Date.now() <= deadline);
  console.log(`${hostname}: ${result.reason}`);
  const counts = await sql`select status,count(*)::int as count from student_homework_videos where tenant_id=${tenant} group by status`;
  const history = await sql`select state->>'scanned' as scanned,state->>'completedAt' as completed
    from classnote_video_history where tenant_id=${tenant}`;
  console.log(JSON.stringify({ ready: result.ready, videos: counts, history }));
  if (!result.ready) process.exitCode = 1;
} catch { console.error("워커 적용 확인 실패 — DB 연결과 지점 설정을 확인하세요."); process.exitCode = 1; }
finally { await sql.end(); }
