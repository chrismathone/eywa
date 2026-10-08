
import { SheetText } from "@/features/teacher-view/interface-label";
import { getStudentHomeworkVideos } from "@/features/students/server/homework-videos";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { HomeworkVideosView } from "./homework-videos-view";
import { HomeworkUploadLog } from "./homework-upload-log";
import { getStudentUploadLog } from "@/features/students/server/homework-upload-log";

export async function HomeworkVideosTab({ studentId, videoId = null }: { studentId: string; videoId?: string | null }) {
  const [result, settings, uploadLog] = await Promise.all([getStudentHomeworkVideos(studentId), getTenantSettings(), getStudentUploadLog(studentId)]);
  if (!result.ready) return <p className="text-sm"><SheetText value={"숙제 영상 보관 기능을 준비 중입니다."} /></p>;
  return <div className="space-y-6"><HomeworkVideosView key={videoId ?? ""} rows={result.rows} subjectLabels={subjectLabelRecord(settings.operations.subjects)} initialVideoId={videoId} /><HomeworkUploadLog result={uploadLog} /></div>;
}
