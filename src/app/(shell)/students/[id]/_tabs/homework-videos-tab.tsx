import { getStudentHomeworkVideos } from "@/features/students/server/homework-videos";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { HomeworkVideosView } from "./homework-videos-view";

export async function HomeworkVideosTab({ studentId }: { studentId: string }) {
  // 강사뷰(실 강사·겸직 강사뷰·다른 강사 뷰)면 effectiveTeacherId가 있다 — 'Drive 열기'는 그 밖(관리자뷰)에서만.
  const [result, settings, teacherId] = await Promise.all([getStudentHomeworkVideos(studentId), getTenantSettings(), effectiveTeacherId()]);
  if (!result.ready) return <p className="text-sm">숙제 영상 보관 기능을 준비 중입니다.</p>;
  return <HomeworkVideosView rows={result.rows} subjectLabels={subjectLabelRecord(settings.operations.subjects)} showDriveLink={!teacherId} />;
}
