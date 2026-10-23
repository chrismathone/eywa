import "server-only";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { enrollmentTimeline, type TimelineEnrollment } from "@/features/students/enrollment/enrollment-timeline";
import { reasonDisplay } from "@/features/withdrawals/types";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, type LiveContext } from "./live-context";

type ClassRow = { class_name: string; subject: string | null; is_makeup_pool: boolean };
type Row = { id: string; class_id: string; start_date: string; end_date: string | null; is_transferred: boolean; withdrawal_reason: string | null;
  cls: ClassRow | ClassRow[] | null };

/** Enrollment events use the existing transfer rule, with the IDs of both records as proof. */
export function readLiveEnrollmentHistory(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=timeline`;
  return readSection("enrollmentHistory", "수강 시작·이동·종료", href, async () => {
    const rows = await fetchAllPaged<Row>((from, to) => c.db.from("enrollments")
      .select("id, class_id, start_date, end_date, is_transferred, withdrawal_reason, cls:class_id(class_name, subject, is_makeup_pool)")
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).order("start_date", { ascending: false }).order("id").range(from, to));
    const normalized = rows.map((r) => ({ ...r, cls: Array.isArray(r.cls) ? r.cls.length === 1 ? r.cls[0] : null : r.cls }));
    const enrollments = normalized.flatMap((r): TimelineEnrollment[] => r.cls && !r.cls.is_makeup_pool ? [{
      id: r.id, classId: r.class_id, className: r.cls.class_name, subject: r.cls.subject,
      startDate: r.start_date, endDate: r.end_date, isTransferred: r.is_transferred, reason: r.withdrawal_reason,
    }] : []);
    const events = enrollmentTimeline(enrollments);
    const result = sectionResult("enrollmentHistory", "수강 시작·이동·종료", href, events.slice(0, 5).map((e): LiveItem => ({
      id: `${e.kind}:${e.sourceIds.join(":")}`, date: e.date, title: `${e.date > c.today ? "예정 · " : ""}${e.title}`,
      detail: reasonDisplay(e.description) || "수강 기간에 따른 기록입니다.",
      evidence: e.sourceIds.map((id) => ({ source: "enrollments", id, studentId: c.studentId, href })),
    })), events.length);
    return { ...result, state: normalized.some((r) => !r.cls) ? "partial" as const : "ready" as const,
      note: "현재 남아 있는 수강 기록 기준입니다. 삭제·요일 변경 등의 이력은 학생 타임라인에서 확인합니다." };
  });
}
