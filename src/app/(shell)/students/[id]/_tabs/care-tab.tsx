import { getStudentCare } from "@/features/student-care/server/queries";
import { StudentCareCard } from "@/features/student-care/components/care-card";
import { CareTaskPanel } from "@/features/student-care/components/care-tasks";
import { NewConsultationLink } from "../../../consultations/_components/new-consultation-link";

export async function CareTab({ studentId }: { studentId: string }) {
  let card;
  try { card = await getStudentCare(studentId); }
  catch {
    return <p role="alert" className="border-line text-text-dim rounded-xl border p-5 text-sm">학생 관리 자료를 확인하지 못했습니다. 잠시 후 다시 열어 주세요.</p>;
  }
  if (!card) return <p className="text-text-dim p-5 text-sm">기록이 없거나 이 학생의 관리 요약을 열람할 권한이 없습니다.</p>;
  return <div className="space-y-5">
    <StudentCareCard card={card} action={<NewConsultationLink studentId={studentId} className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-semibold">지원 상담 기록</NewConsultationLink>} />
    <CareTaskPanel key={studentId} studentId={studentId} />
  </div>;
}
