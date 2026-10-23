import "server-only";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";

const LABELS = { overdue: "예정일 지남", today: "오늘 예정", soon: "3일 이내 예정", later: "진행 예정", none: "날짜 미정", done: "완료" };
export function readLiveFollowUps(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=consultations`;
  const label = "남은 상담 후속조치";
  if (!c.consultations) return Promise.resolve(unavailableSection("followUps", label, href, "forbidden"));
  return readSection("followUps", label, href, async () => {
    const teacher = await effectiveTeacherId();
    let query = c.db.from("student_consultations").select("id, follow_up_action, follow_up_date", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).eq("follow_up_done", false)
      .or("follow_up_date.not.is.null,and(follow_up_action.not.is.null,follow_up_action.neq.)");
    if (teacher) query = query.eq("counselor_id", teacher);
    const { data, count, error } = await query.order("follow_up_date", { ascending: true, nullsFirst: false }).order("id").limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing follow-up count");
    return { ...sectionResult("followUps", label, href, (data ?? []).map((r): LiveItem => ({
      id: r.id, title: LABELS[followUpUrgency(r.follow_up_date, false, c.today)], date: r.follow_up_date ?? undefined,
      detail: r.follow_up_action?.trim().slice(0, 180) || "후속조치 내용이 기록되지 않았습니다.",
      evidence: [{ source: "student_consultations", id: r.id, studentId: c.studentId, href: `/consultations/${r.id}` }],
    })), count), note: "완료로 표시되지 않은 후속조치입니다. 예정일이 빠른 순서로 표시합니다." };
  });
}
