import { NextResponse } from "next/server";
import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { isReviewAssetPath, REVIEW_BUCKET, reviewAssetPath } from "@/features/video-review/storage-paths";

/**
 * 발송 PC 워커 전용 — 영상 설명 AI 참고 메모(0390a)의 소리·화면을 올릴 **서명된 올리기 주소**를 내준다(원장 2026-10-20).
 * ⚠️ 게이트: `x-eywa-internal`(video-drive-token과 같은 `authorizeInternalWorker`) + 그 지점의 기능 스위치(`video_review`, 기본 꺼짐).
 *
 * 요청 `{tenantId, reviewId, videoId, lockToken, names[]}` — 그 줄이 이 지점·이 영상의 **추출 대기**(`stage='extract'`)이고 **지금 이 워커가
 * 잠근 줄**(`lock_token = lockToken` · 잠금이 10분 안)일 때만 — 잠금을 잃은 옛 실행이 새 실행의 파일을 덮어쓰지 못하게. 이름은
 * `storage-paths.ts` 규칙(audio.mp3 · fNN_MMmSSs.jpg · last_MMmSSs_hi.jpg)에 맞는 것만(최대 16개).
 * 응답 `{uploads:[{name, path, signedUrl}]}` — 같은 경로는 덮어쓴다(다시 시도한 추출이 같은 이름으로 올린다).
 * 오류: 401 인증 · 403 지점·형식 불일치 · 404 줄 없음 · 409 추출 대기 아님 · 503 일시 장애. 🔴 서명 주소·사유 원문을 로그에 싣지 않는다.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAMES = 16;
/** 워커 잠금 수명(워커의 `locked_at < now() - 10분`이면 남이 집는다)과 같은 값. */
const LEASE_MS = 10 * 60_000;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: Request) {
  const authorization = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!authorization) return reply({ error: "인증에 실패했습니다." }, 401);
  const body = (await request.json().catch(() => null)) as
    { tenantId?: unknown; reviewId?: unknown; videoId?: unknown; lockToken?: unknown; names?: unknown } | null;
  const { tenantId, reviewId, videoId, lockToken, names } = body ?? {};
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId) || typeof reviewId !== "string" || !UUID_RE.test(reviewId) ||
    typeof videoId !== "string" || !UUID_RE.test(videoId) || typeof lockToken !== "string" || !UUID_RE.test(lockToken) || !Array.isArray(names) || names.length === 0 || names.length > MAX_NAMES)
    return reply({ error: "요청 형식이 올바르지 않습니다." }, 403);
  if (authorization.tenantId && tenantId !== authorization.tenantId) return reply({ error: "다른 지점의 요청입니다." }, 403);
  const paths = names.map((name) => (typeof name === "string" ? reviewAssetPath(tenantId, videoId, name) : ""));
  if (paths.some((p) => !isReviewAssetPath(p, tenantId, videoId)) || new Set(paths).size !== paths.length)
    return reply({ error: "파일 이름이 규칙에 맞지 않습니다." }, 403);
  try {
    if (!(await isFeatureOptedIn(tenantId, "video_review"))) return reply({ error: "이 지점은 기능이 꺼져 있습니다." }, 409);
    const db = createAdminClient();
    const { data: row, error } = await db.from("homework_video_reviews").select("id, stage, lock_token, locked_at")
      .eq("id", reviewId).eq("tenant_id", tenantId).eq("video_id", videoId).maybeSingle();
    if (error) return reply({ error: "잠시 후 다시 시도하세요." }, 503);
    if (!row) return reply({ error: "작업을 찾을 수 없습니다." }, 404);
    if (row.stage !== "extract") return reply({ error: "추출 대기 중인 작업이 아닙니다." }, 409);
    const lockedAt = row.locked_at ? Date.parse(row.locked_at) : NaN;
    if (row.lock_token !== lockToken || !Number.isFinite(lockedAt) || Date.now() - lockedAt > LEASE_MS)
      return reply({ error: "이 작업의 잠금이 다른 실행으로 넘어갔습니다." }, 409);
    const uploads = [];
    for (const [i, path] of paths.entries()) {
      const signed = await db.storage.from(REVIEW_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (signed.error || !signed.data?.signedUrl) return reply({ error: "잠시 후 다시 시도하세요." }, 503);
      uploads.push({ name: names[i] as string, path, signedUrl: signed.data.signedUrl });
    }
    return reply({ uploads }, 200);
  } catch {
    console.error(JSON.stringify({ level: "error", scope: "videoReview.upload", kind: "unavailable" }));
    return reply({ error: "잠시 후 다시 시도하세요." }, 503);
  }
}
