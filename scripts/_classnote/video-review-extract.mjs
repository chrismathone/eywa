// scripts/_classnote/video-review-extract.mjs — 영상 설명 AI 참고 메모(0390a `homework_video_reviews`, 원장 2026-10-20)의 **추출 단계**.
//
// 서버 cron이 새 수학 영상마다 `stage='extract'` 줄을 만든다. 발송 PC가 그 줄을 집어 드라이브에서 원본을 받고, ffmpeg로
// 소리(mp3)와 화면(jpg 13장)을 뽑아 비공개 버킷(homework-video-review)에 올린 뒤 `stage='transcribe'`로 넘긴다. 이후 전사·판정은 서버 몫.
// ffmpeg·드라이브 인증이 이미 있는 발송 PC에서 한다(원장 결정 — 서버에서 800MB 영상을 받으면 시간 제한에 걸린다).
//
// 🔴 원본 영상은 PC에 잠깐만 둔다(끝나면 지운다). 올린 소리·화면은 판정용이고 화면에 나가지 않는다 — 나가는 것은 분석 결과뿐.
// 🔴 잠금은 이 표의 `lock_token`·`locked_at`(ClassNote 영상 줄과 별개). 영상 보관 작업이 도는 동안(`busy`)은 시작하지 않는다.
// 로컬 시험(맥): `node --env-file=.env.local scripts/_classnote/video-review-extract.mjs --once [--tenant <uuid>]`
import postgres from "postgres";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { stateDir } from "./classnote-paths.mjs";
import { defaultRunner, findFfmpeg } from "./video-ffmpeg.mjs";
import { loadWorkerVideoDriveSetting } from "./video-drive-settings.mjs";
import { credentialForVideoTarget } from "./video-drive-token.mjs";
import { extractClaimedReview } from "./video-review-extract-job.mjs";

/** 할 일이 없을 때 다시 보는 간격 — 판정은 밤 배치라 서두를 것 없다. 한 건을 끝내면 바로 다음 건. */
export const REVIEW_EXTRACT_POLL_MS = 5 * 60_000;

let running = null;
let controller = null;
let nextPoll = 0;
let stopped = false;
let lastNotice = null;

export function stopVideoReviewExtract() {
  stopped = true;
  controller?.abort(new Error("작업 종료 요청"));
}
export async function waitForReviewExtractIdle() { if (running) await running; }

/** 이 지점의 추출 대기 한 건을 잠근다(오래된 것부터 · 남이 잡은 줄은 건너뛴다). 없으면 null. */
export async function claimNextReview(sql, tenant, token) {
  const [row] = await sql`update homework_video_reviews r set lock_token = ${token}, locked_at = now(), attempts = r.attempts + 1
    where r.id = (
      select id from homework_video_reviews
      where tenant_id = ${tenant} and stage = 'extract' and available_at <= now()
        and (lock_token is null or locked_at < now() - interval '10 minutes')
      order by created_at, id limit 1 for update skip locked)
    returning r.id, r.video_id, r.attempts`;
  return row ?? null;
}

/** 한 건 처리. 반환 { worked } — 집었으면 true(성공·실패 무관). */
export async function extractNextReview(tenant, deps) {
  const token = deps.token();
  const row = await claimNextReview(deps.sql, tenant, token);
  if (!row) return { worked: false };
  await extractClaimedReview(tenant, row, token, deps);
  return { worked: true };
}

function notice(log, text) {
  if (text !== lastNotice && text) log(text);
  lastNotice = text;
}

async function runOnce(tenant, log, options, signal) {
  const env = options.env ?? process.env;
  const tools = await findFfmpeg({ env });
  if (!tools) { notice(log, "[AI 메모·추출] ffmpeg를 찾지 못해 건너뜁니다."); return { worked: false }; }
  const root = stateDir();
  if (!root) { notice(log, "[AI 메모·추출] 임시 저장 폴더를 열 수 없어 건너뜁니다."); return { worked: false }; }
  notice(log, null);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const setting = options.setting ?? await loadWorkerVideoDriveSetting(sql, tenant, { env });
    if (setting.error) return { worked: false };
    return await extractNextReview(tenant, {
      sql, log, env, setting, signal, tools, runner: options.runner ?? defaultRunner,
      workDir: path.join(env.CLASSNOTE_VIDEO_OUT || path.join(root, "videos"), tenant, "review"),
      now: () => new Date(), token: randomUUID, fetchImpl: options.fetchImpl ?? fetch, credentialsFor: credentialForVideoTarget,
    });
  } finally { await sql.end(); }
}

/** 발송 루프가 매 주기 부른다(기다리지 않는다). 한 번에 한 건 · 영상 보관 작업이 도는 동안(`busy`)은 시작하지 않는다. */
export function kickVideoReviewExtract(tenant, log = console.log, options = {}) {
  if (running || stopped || Date.now() < nextPoll || options.busy?.()) return running;
  nextPoll = Date.now() + REVIEW_EXTRACT_POLL_MS;
  const abort = new AbortController();
  controller = abort;
  running = runOnce(tenant, log, options, abort.signal)
    .then((result) => { if (result?.worked && !abort.signal.aborted) nextPoll = 0; })
    .catch(() => log("[AI 메모·추출] 확인하지 못했습니다 — 다음 주기에 다시 봅니다."))
    .finally(() => { running = null; if (controller === abort) controller = null; });
  return running;
}

/** 시험 전용 — 주기·종료 상태를 되돌린다. */
export function resetVideoReviewExtract() { running = null; controller = null; nextPoll = 0; stopped = false; lastNotice = null; }

// 맥 로컬 시험: 한 건만 하고 끝낸다(발송·ClassNote는 건드리지 않는다).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--once")) {
  const i = process.argv.indexOf("--tenant");
  const tenant = (i > 0 ? process.argv[i + 1] : process.env.CLASSNOTE_TENANT_ID) ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tenant)) { console.error("--tenant <uuid> 또는 CLASSNOTE_TENANT_ID가 필요합니다."); process.exit(2); }
  const result = await runOnce(tenant, console.log, {}, undefined);
  console.log(result?.worked ? "[AI 메모·추출] 한 건 처리했습니다." : "[AI 메모·추출] 처리할 영상이 없습니다.");
}
