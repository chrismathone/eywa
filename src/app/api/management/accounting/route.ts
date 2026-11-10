import { z } from "zod";
import { managementAccess } from "@/features/management/server/access";
import { saveAccounting } from "@/features/management/server/store";
import { failure, forbidden, noStore, sameOrigin, wrongOrigin } from "@/features/management/server/http";
import { ManagementInputError } from "@/features/management/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * ECOUNT 회계 자료 — multipart = 파일 미리보기(저장 안 함 · 손익계산서 .xlsx 또는 계정별원장 .csv),
 * JSON = 원장이 검토한 한 기간 저장(버전 비교). 무거운 엑셀 해석은 이 라우트에서만 불러온다(B5).
 */
export async function POST(request: Request) {
  try { await managementAccess(true); } catch { return forbidden(); }
  if (!sameOrigin(request)) return wrongOrigin();
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > 5_500_000) throw new ManagementInputError("파일 크기는 5MB 이하로 제한됩니다");
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || !/\.(xlsx|csv)$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new ManagementInputError("5MB 이하의 ECOUNT 손익계산서 .xlsx 또는 계정별원장 .csv를 선택해 주세요");
      const bytes = Buffer.from(await file.arrayBuffer());
      if (file.name.toLowerCase().endsWith(".csv")) {
        const { parseEcountLedger } = await import("@/features/management/ecount-ledger");
        return noStore(parseEcountLedger(bytes, file.name));
      }
      const { parseEcountProfitLoss } = await import("@/features/management/ecount");
      return noStore({ document: await parseEcountProfitLoss(bytes, file.name) });
    }
    const text = await request.text();
    if (text.length > 1_000_000) throw new ManagementInputError("자료 크기를 확인해 주세요");
    const input = z.object({ document: z.unknown(), expectedVersion: z.number().int().min(0) }).strict().parse(JSON.parse(text));
    return noStore({ saved: await saveAccounting(input.document, input.expectedVersion) });
  } catch (e) {
    return failure(e, "api/management/accounting", "입력한 회사·기간·계정 정보를 확인해 주세요", "자료를 처리하지 못했습니다. 파일 형식을 확인하고 다시 시도해 주세요.");
  }
}
