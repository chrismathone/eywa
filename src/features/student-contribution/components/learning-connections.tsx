"use client";
import { getStudentLearningConnections } from "../server/learning-actions";
import { getStudentCommunicationConnections } from "../server/communication-actions";
import { ExpandableConnections } from "./expandable-connections";
import { useModuleOn } from "@/features/owner/operations-context";

export function LearningConnections({ studentId }: { studentId: string }) {
  const shuttleOn = useModuleOn("shuttle");
  return <ExpandableConnections studentId={studentId} title="학습·등원 기록 연결"
    description={shuttleOn
      ? "출결·학습 계획·성적·진도·교재·영상과 셔틀 기록을 확인합니다."
      : "출결·학습 계획·성적·진도·교재·영상 기록을 확인합니다."}
    loadAction={getStudentLearningConnections} />;
}
export function CommunicationConnections({ studentId }: { studentId: string }) {
  return <ExpandableConnections studentId={studentId} title="소통·수강 이력" columns={2}
    description="남은 상담 후속조치와 연결된 소통 기록, 수강의 변화를 확인합니다." loadAction={getStudentCommunicationConnections} />;
}
