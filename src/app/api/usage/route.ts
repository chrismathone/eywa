import { getCurrentUser } from "@/lib/auth/current-user";
import { MAX_BEACON_BYTES, toUsageRows, usagePayloadSchema } from "@/features/usage/ingest";
import { recordPageUsage } from "@/features/usage/server/record";

/**
 * 이용 분석 비콘 수신 — 셸 계측기([`usage-tracker.tsx`](src/features/usage/usage-tracker.tsx))가 10분마다·화면을 숨길 때 보낸다.
 *
 * 응답 본문은 없다(비콘은 응답을 읽지 않는다). 잘못된 본문은 400, 비로그인은 204로 조용히 버린다.
 * ⚠️ `/api`는 proxy 매처 밖이다 — 세션 갱신은 getCurrentUser(getClaims)가 한다.
 */
export const dynamic = "force-dynamic";

const empty = (status: number) => new Response(null, { status });

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BEACON_BYTES) return empty(413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return empty(400);
  }
  const parsed = usagePayloadSchema.safeParse(json);
  if (!parsed.success) return empty(400);

  const user = await getCurrentUser();
  if (!user) return empty(204);
  await recordPageUsage(user, toUsageRows(parsed.data.items));
  return empty(204);
}
