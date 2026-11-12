"use server";
import { getLiveContext } from "./live-context";
import { readLiveGrades, readLiveReports, readLiveTextbooks, readLiveVideos } from "./live-learning";
import { readLiveLearningPlan } from "./live-learning-plan";
import { readLiveShuttle } from "./live-shuttle";
import { readLiveAttendance } from "./live-attendance";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/** Explicit, read-only expansion: does not add learning-source reads to tab navigation. */
export async function getStudentLearningConnections(studentId: string) {
  const [context, settings] = await Promise.all([getLiveContext(studentId), getTenantSettings()]);
  if (!context) return { error: "해당 학생의 학습 기록을 열람할 수 없습니다." };
  const reads = [readLiveAttendance(context), ...(isModuleEnabled(settings.modules.disabled, "mcs") ? [readLiveLearningPlan(context)] : []), readLiveGrades(context), readLiveReports(context), readLiveTextbooks(context), readLiveVideos(context), ...(isModuleEnabled(settings.modules.disabled, "shuttle") ? [readLiveShuttle(context)] : [])];
  return { sections: await Promise.all(reads) };
}
