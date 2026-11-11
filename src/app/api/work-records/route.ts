import { saveWorkRecord } from "@/features/work-records/server";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 업무 작성센터 저장 — 작성·검토 권한 판정은 saveWorkRecord(서버) · 표 academy_work_records(s2_0048). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 40000, "work-records", async (body) => ({ saved: await saveWorkRecord(body) }));
}
