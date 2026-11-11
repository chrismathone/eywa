import { z } from "zod";
import { monthSchema } from "@/features/management/model";
import { managementAccess } from "@/features/management/server/access";
import { previewCollection } from "@/features/management/server/collection";
import { saveSourceEvidenceBatch } from "@/features/management/server/reviews";
import { failure, forbidden, noStore, sameOrigin, wrongOrigin } from "@/features/management/server/http";
import { ManagementInputError } from "@/features/management/errors";

export const runtime = "nodejs";
export const maxDuration = 30;
const inputSchema = z.object({ source: z.enum(["makeedu", "ecount"]), month: monthSchema, mode: z.enum(["preview", "commit"]), scope: z.literal("true"), fullScope: z.string().nullable(), planHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();

/**
 * 자료 수집함 — preview = 서버가 다시 계산한 대조 결과만 돌려준다(저장 없음).
 * commit = 같은 파일로 다시 계산해 미리보기 지문(planHash)이 같을 때만 대조 기록을 한 번에 저장(같은 파일·같은 비교 자료는 중복 저장 안 함).
 */
export async function POST(request: Request) {
  try { await managementAccess(true); } catch { return forbidden(); }
  if (!sameOrigin(request)) return wrongOrigin();
  try {
    if (!request.headers.get("content-type")?.includes("multipart/form-data") || Number(request.headers.get("content-length") ?? 0) > 4_400_000) throw new ManagementInputError("4MB 이하 원본 엑셀을 선택해 주세요");
    const form = await request.formData(), file = form.get("file");
    const input = inputSchema.parse({ source: form.get("source"), month: form.get("month"), mode: form.get("mode"), scope: form.get("scope"), fullScope: form.get("fullScope"), planHash: form.get("planHash") });
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > 4 * 1024 * 1024) throw new ManagementInputError("4MB 이하 .xlsx 원본 파일이 필요합니다");
    if (input.source === "makeedu" && input.fullScope !== "true") throw new ManagementInputError("전체원생·전체수납·이전달 미납 제외 조건과 청구월을 확인해 주세요");
    const plan = await previewCollection(input.source, input.month, Buffer.from(await file.arrayBuffer()), file.name);
    if (input.mode === "preview") return noStore(plan);
    if (input.planHash !== plan.planHash) return noStore({ error: "미리보기 이후 비교 자료가 바뀌었습니다. 다시 검증해 주세요." }, 409);
    const saved = await saveSourceEvidenceBatch(plan.evidence);
    return noStore({ ...saved, months: plan.evidence.map((e) => e.month) });
  } catch (e) {
    return failure(e, "api/management/collection", "자료 종류·월·확인 항목을 선택해 주세요", "수집 검증을 처리하지 못했습니다. 파일 형식을 확인하고 다시 시도해 주세요.");
  }
}
