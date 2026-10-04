import { getStudentHomeworkVideos } from "@/features/students/server/homework-videos";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { HomeworkVideosView } from "./homework-videos-view";

export async function HomeworkVideosTab({ studentId, videoId = null }: { studentId: string; videoId?: string | null }) {
  const [result, settings] = await Promise.all([getStudentHomeworkVideos(studentId), getTenantSettings()]);
  if (!result.ready) return <p className="text-sm">숙제 영상 보관 기능을 준비 중입니다.</p>;
  return <HomeworkVideosView key={videoId ?? ""} rows={result.rows} subjectLabels={subjectLabelRecord(settings.operations.subjects)} initialVideoId={videoId} />;
}
