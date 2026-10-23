import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { foldedReason } from "@/lib/folded-read";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteReplyMode } from "@/features/owner/classnote-gate";
import { PARENT_THREAD_DAYS } from "@/features/classnote-reply/server/reply-queries";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";

/** Same tenant staff source and module/menu gate as the original board. No inference from names. */
export async function readLiveParentMessages(c: LiveContext) {
  const href = "/lesson-reports?tab=classnote&section=parent_replies";
  const label = `최근 ${PARENT_THREAD_DAYS}일 학부모 글`;
  let settings;
  try { settings = await getTenantSettings(); }
  catch { return unavailableSection("parentMessages", "소통 기록", href, "failed"); }
  if (foldedReason(settings)) return unavailableSection("parentMessages", "소통 기록", href, "failed");
  if (classnoteReplyMode(settings) === "off") return null;
  return readSection("parentMessages", label, href, async () => {
    if (!await canAccessTenant(c.role, "lesson_reports")) return unavailableSection("parentMessages", label, href, "forbidden");
    const since = new Date(Date.parse(c.checkedAt) - PARENT_THREAD_DAYS * 86_400_000).toISOString();
    const { data, count, error } = await c.db.from("classnote_parent_messages").select("id, source, content, posted_at", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).gte("posted_at", since).lte("posted_at", c.checkedAt)
      .order("posted_at", { ascending: false }).order("id", { ascending: false }).limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing parent message count");
    return { ...sectionResult("parentMessages", label, href, (data ?? []).map((r): LiveItem => ({
      id: r.id, title: r.source === "comment" ? "학부모 댓글" : "학부모 글", date: r.posted_at ?? undefined,
      detail: r.content?.slice(0, 180) || "본문이 없는 기록입니다.",
      evidence: [{ source: "classnote_parent_messages", id: r.id, studentId: c.studentId, href }],
    })), count), note: "이 학생에게 연결된 글만 표시합니다. 답글과 첨부는 원본 목록에서 확인할 수 있습니다." };
  });
}
