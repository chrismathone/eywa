import "server-only";
import { getMathSheetMonth } from "@/features/math-sheets/server/month-queries";
import { getMathLearningData } from "@/features/math-sheets/server/learning-queries";

/** The MCS gate and its month roster authorize every real map, including direct URLs. */
export async function getStudentLearningMap(classId: string, studentId: string, month: string | null) {
  const result = await getMathSheetMonth(classId, month);
  if (!result.ok) return { status: "not-found" } as const;
  const { data } = result;
  const student = data.students.find(row => row.studentId === studentId);
  if (!student) return { status: "not-found" } as const;
  const learning = await getMathLearningData(classId, data, { studentId, allRecords: true });
  const identity = { student: { studentId, name: student.name, school: student.school, grade: student.grade }, classId, className: data.className, month: data.month };
  if (learning.status !== "ok") return { status: "failed", ...identity } as const;
  const goal = learning.goals[studentId], progress = learning.progress[studentId];
  if (!goal || !progress) return { status: "no-goal", ...identity } as const;
  return { status: "ok", ...identity, goal, progress, records: learning.records[studentId] ?? [] } as const;
}
