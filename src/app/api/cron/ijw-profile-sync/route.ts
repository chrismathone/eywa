import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { pushIjwProfiles } from "@/features/ijw/server/profile-push";

/**
 * 하루 한 번 — 인재원 짝을 맞춘 학생 **전원**의 학교·학년·생년월일을 인재원에 다시 보낸다(원장 2026-10-08). 학생 저장 때 보내는 것을
 * 놓친 경우(엑셀 가져오기·makeedu 동기화처럼 저장 액션을 안 거친 변경)를 메운다. 같은 값을 다시 보내도 된다(인재원은 덮어쓰기).
 * 인재원 연동은 한 학원(`IJW_TENANT_ID`)뿐이라 그 학원만 보낸다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenantId = (process.env.IJW_TENANT_ID ?? "").trim();
  if (!tenantId) return NextResponse.json({ ok: true, skipped: "IJW_TENANT_ID 미설정" });
  const res = await pushIjwProfiles(tenantId);
  return NextResponse.json(
    res.ok
      ? { ok: true, sent: res.sent, updated: res.updated, notFound: res.notFound.length, invalid: res.invalid.length }
      : { ok: false, reason: res.reason },
  );
}
