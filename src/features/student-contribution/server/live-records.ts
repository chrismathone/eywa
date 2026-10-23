import "server-only";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";

const TAKE = 5;
export function readLiveMemos(c: LiveContext, fullText = false) {
  const href = `/students/${c.studentId}?tab=memos`;
  return readSection("memos", "최근 메모", href, async () => {
    const { data, count, error } = await c.db.from("student_memos").select("id, content, category, created_at, searchable", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).order("created_at", { ascending: false }).order("id").limit(TAKE);
    if (error) throw error;
    if (count === null) throw new Error("Missing memo count");
    return sectionResult("memos", "최근 메모", href, (data ?? []).map((r): LiveItem => ({ id: r.id,
      title: "학생 메모", detail: (fullText ? r.content : r.content?.slice(0, 180)) || "내용이 없는 메모", date: r.created_at, summaryExcluded: r.searchable !== true,
      evidence: [{ source: "student_memos", id: r.id, studentId: c.studentId, href }] })), count);
  });
}

export function readLiveConsultations(c: LiveContext, fullText = false) {
  const href = `/students/${c.studentId}?tab=consultations`;
  if (!c.consultations) return Promise.resolve(unavailableSection("consultations", "최근 상담", href, "forbidden"));
  return readSection("consultations", "최근 상담", href, async () => {
    const teacher = await effectiveTeacherId();
    let query = c.db.from("student_consultations").select("id, summary, consulted_at, counselor:counselor_id(display_name)", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId);
    if (teacher) query = query.eq("counselor_id", teacher);
    const { data, count, error } = await query.order("consulted_at", { ascending: false }).order("id").limit(TAKE);
    if (error) throw error;
    if (count === null) throw new Error("Missing consultation count");
    return sectionResult("consultations", "최근 상담", href, (data ?? []).map((r): LiveItem => {
      const counselor = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as { display_name: string } | null;
      const content = visibleConsultationSummary(r.summary);
      return { id: r.id, title: `상담자 ${counselor?.display_name ?? "기록 없음"}`, detail: (fullText ? content : content.slice(0, 180)) || "상담 내용이 없습니다.",
        date: r.consulted_at, evidence: [{ source: "student_consultations", id: r.id, studentId: c.studentId, href: `/consultations/${r.id}` }] };
    }), count);
  });
}
