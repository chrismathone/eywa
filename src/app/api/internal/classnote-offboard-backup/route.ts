import { NextResponse } from "next/server";
import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { OFFBOARD_BACKUP_BUCKET, offboardBackupDir, offboardBackupPath } from "@/features/classnote-offboard/backup-path";

/**
 * 발송 PC 워커 전용 — **ClassNote 명부 퇴원처리(퇴소) 직전 백업**을 올릴 서명된 주소를 내준다(원장 2026-11-03 *"남은 수강과목이 1개도 없는 경우에는
 * 45일 뒤 자동으로 퇴원처리"* · 퇴원처리 직전 그 원아의 글 목록 백업). 퇴소하면 센터 계정에서 그 원아의 글이 0건이 된다(실측) — 백업이 먼저다.
 * ⚠️ 게이트: `x-eywa-internal`(video-review 업로드와 같은 `authorizeInternalWorker`) · 연동 PC는 자기 지점만.
 *
 * 요청 `{tenantId, childId, date}` → `{path, signedUrl}`(같은 경로는 덮어쓴다 — 다시 시도한 실행이 같은 이름으로 올린다).
 * 요청 `{tenantId, childId, date, verify:true}` → `{exists, size}`(올라갔는지 워커가 다시 묻는다 — 확인 못 하면 퇴원처리하지 않는다).
 * 저장 = 비공개 버킷 `classnote-backups/{지점}/offboard/{날짜}/{원아}.json`(새 SQL 없음 · 지점 접두).
 * 오류: 401 인증 · 403 형식·지점 불일치 · 503 일시 장애. 🔴 서명 주소를 로그에 싣지 않는다.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" } as const;
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: Request) {
  const authorization = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!authorization) return reply({ error: "인증에 실패했습니다." }, 401);
  const body = (await request.json().catch(() => null)) as { tenantId?: unknown; childId?: unknown; date?: unknown; verify?: unknown } | null;
  const { tenantId, childId, date, verify } = body ?? {};
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return reply({ error: "요청 형식이 올바르지 않습니다." }, 403);
  if (authorization.tenantId && tenantId !== authorization.tenantId) return reply({ error: "다른 지점의 요청입니다." }, 403);
  const path = offboardBackupPath(tenantId, childId, date);
  if (!path) return reply({ error: "요청 형식이 올바르지 않습니다." }, 403);
  try {
    const bucket = createAdminClient().storage.from(OFFBOARD_BACKUP_BUCKET);
    if (verify === true) {
      const { data, error } = await bucket.list(offboardBackupDir(tenantId, date as string), { search: `${childId}.json`, limit: 10 });
      if (error) return reply({ error: "잠시 후 다시 시도하세요." }, 503);
      const hit = (data ?? []).find((f) => f.name === `${childId}.json`);
      const size = Number((hit?.metadata as { size?: unknown } | null)?.size ?? 0);
      return reply({ exists: !!hit, size: Number.isFinite(size) ? size : 0 }, 200);
    }
    const signed = await bucket.createSignedUploadUrl(path, { upsert: true });
    if (signed.error || !signed.data?.signedUrl) return reply({ error: "잠시 후 다시 시도하세요." }, 503);
    return reply({ path, signedUrl: signed.data.signedUrl }, 200);
  } catch {
    console.error(JSON.stringify({ level: "error", scope: "classnoteOffboard.backup", kind: "unavailable" }));
    return reply({ error: "잠시 후 다시 시도하세요." }, 503);
  }
}
