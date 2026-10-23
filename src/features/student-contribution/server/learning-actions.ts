"use server";
import { getLiveContext } from "./live-context";
import { readLiveGrades, readLiveReports, readLiveTextbooks, readLiveVideos } from "./live-learning";
import { readLiveLearningPlan } from "./live-learning-plan";
import { readLiveShuttle } from "./live-shuttle";
import { readLiveAttendance } from "./live-attendance";

/** Explicit, read-only expansion: does not add learning-source reads to tab navigation. */
export async function getStudentLearningConnections(studentId: string) {
  const context = await getLiveContext(studentId);
  if (!context) return { error: "해당 학생의 학습 기록을 열람할 수 없습니다." };
  return { sections: await Promise.all([readLiveAttendance(context), readLiveLearningPlan(context), readLiveGrades(context), readLiveReports(context), readLiveTextbooks(context), readLiveVideos(context), readLiveShuttle(context)]) };
}
