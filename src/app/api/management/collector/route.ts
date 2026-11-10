import { z } from "zod";
import { collectorAccess, recordCollectorResult, CollectorError } from "@/features/management/server/collector-auth";
import { previewCollectionFor } from "@/features/management/server/collection";
import { saveSourceEvidenceBatchFor } from "@/features/management/server/reviews";
import { sha256 } from "@/features/management/makeedu-export";
import { monthSchema } from "@/features/management/model";
import { collectorScope } from "@/features/management/collector-contract";
import { noStore } from "@/features/management/server/http";
import { ManagementInputError } from "@/features/management/errors";

export const runtime = "nodejs";
export const maxDuration = 30;
const fields = z.object({ source: z.enum(["makeedu", "ecount"]), month: monthSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/), scope: z.literal("true"), fullScope: z.literal("true") }).strict();
/** PC는 업로드 이름을 ASCII로만 보낸다(PowerShell 5.1이 한글 파일 이름을 깨뜨린다) — 원래 이름은 base64(UTF-8) 칸으로 따로 온다. */
function originalName(raw: FormDataEntryValue | null, fallback: string) {
  if (typeof raw !== "string" || raw.length > 1200 || !/^[A-Za-z0-9+/]+=*$/.test(raw)) return fallback;
  const name = Buffer.from(raw, "base64").toString("utf8").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name && !name.includes("\ufffd") ? name.slice(0, 200) : fallback;
}
const deny = (e: unknown) => noStore({ error: e instanceof CollectorError ? e.code : "connection_unavailable" }, e instanceof CollectorError ? e.status : 503);

/** 학원 PC 수집기 연결 확인(쿠키 없음 · 기기 토큰만). 지점 스위치가 꺼져 있으면 거절한다. */
export async function GET(request: Request) {
  try {
    const u = await collectorAccess(request.headers.get("authorization"));
    return noStore({ connected: true, tenantId: u.tenantId, deviceId: u.deviceId, scope: collectorScope });
  } catch (e) { return deny(e); }
}

/**
 * PC가 보낸 원본 엑셀 → 서버가 다시 대조해 대조 기록만 저장(청구·학생·회계 자료는 고치지 않는다).
 * 지점·행위자는 기기 줄에서 정하고(본문 값 무시) 저장 직전에 연결을 한 번 더 확인한다(해제 경합).
 */
export async function POST(request: Request) {
  let user;
  try { user = await collectorAccess(request.headers.get("authorization"), true); } catch (e) { return deny(e); }
  try {
    if (!request.headers.get("content-type")?.includes("multipart/form-data") || Number(request.headers.get("content-length") ?? 0) > 4_400_000) return noStore({ error: "invalid_file" }, 400);
    const form = await request.formData(), file = form.get("file");
    const v = fields.parse({ source: form.get("source"), month: form.get("month"), sourceHash: form.get("sourceHash"), scope: form.get("scope"), fullScope: form.get("fullScope") });
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".xlsx")) return noStore({ error: "invalid_file" }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (sha256(bytes) !== v.sourceHash) return noStore({ error: "file_changed" }, 409);
    const plan = await previewCollectionFor(user, v.source, v.month, bytes, originalName(form.get("sourceName"), file.name));
    const active = await collectorAccess(request.headers.get("authorization"));
    if (active.deviceId !== user.deviceId || active.tenantId !== user.tenantId) throw new CollectorError(403, "connection_changed");
    const saved = await saveSourceEvidenceBatchFor(user, plan.evidence), issues = plan.evidence.reduce((n, e) => n + e.issues.length, 0), months = plan.evidence.map((e) => e.month);
    await recordCollectorResult(user, { code: "saved", source: v.source, months, issues });
    return noStore({ ...saved, sourceHash: v.sourceHash, months, issues });
  } catch (e) {
    // 400 = 고쳐지지 않는 요청(PC가 하루 뒤 다시) · 409 = 사람이 고치면 풀리는 자료 문제(다음 주기에 다시) · 503 = 일시 오류(다음 주기에 다시).
    const input = e instanceof ManagementInputError;
    const code = e instanceof CollectorError ? e.code : e instanceof z.ZodError ? "invalid_metadata" : input ? "review_required" : "connection_unavailable";
    if (!(e instanceof CollectorError) && !(e instanceof z.ZodError) && !input) console.error("[api/management/collector]", e);
    try { await recordCollectorResult(user, { code }); } catch { /* 저장이 이미 됐을 수 있다 — 같은 파일로 다시 보내도 중복 저장되지 않는다. */ }
    return noStore({ error: code }, e instanceof CollectorError ? e.status : e instanceof z.ZodError ? 400 : input ? 409 : 503);
  }
}
