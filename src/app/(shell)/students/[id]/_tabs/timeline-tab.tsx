import { getStudentTimeline } from "@/features/students/server/queries";
import { TimelineView } from "./timeline-view";

export async function TimelineTab({ studentId }: { studentId: string }) {
  // 한 학생분 전 이벤트(최신순)를 한 번에 가져와 클라가 월별로 페이지네이션(반응속도: 월 전환에 서버 왕복 없음).
  const events = await getStudentTimeline(studentId);
  return <TimelineView events={events} />;
}
