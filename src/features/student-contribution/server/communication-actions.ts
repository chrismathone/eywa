"use server";
import { getLiveContext } from "./live-context";
import { readLiveFollowUps } from "./live-follow-ups";
import { readLiveParentMessages } from "./live-parent-messages";
import { readLiveEnrollmentHistory } from "./live-enrollment-history";
import { readLiveStudentStatus } from "./live-student-status";

export async function getStudentCommunicationConnections(studentId: string) {
  const context = await getLiveContext(studentId);
  if (!context) return { error: "해당 학생의 기록을 열람할 수 없습니다." };
  const sections = await Promise.all([readLiveFollowUps(context), readLiveParentMessages(context), readLiveStudentStatus(context), readLiveEnrollmentHistory(context)]);
  return { sections: sections.filter((s) => s !== null) };
}
