"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TeacherWork } from "@/features/dashboard/overview/teacher-work";
import { TeacherWorkCard, workRatio } from "../../dashboard/_overview/teacher-work-card";

/**
 * 직원 평가 '업무 현황' 면 — 대시보드 '강사별 업무 현황'을 옮겨 왔다(원장 2026-10-29 *"강사 자료는 강사평가로"*).
 * 들어오면 **학원 전체 합계**가 먼저(원장 *"전체가 먼저 뜨고, 필요해서 누르고 들어가면 개별 리스트"*), [강사별 보기]를 눌러야 강사 열 표.
 * 합계는 표의 같은 숫자를 더한 것이다(판정은 대시보드와 한 벌 — `teacherWork()`).
 */
export function WorkFace({ data, subjects }: { data: TeacherWork; subjects: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const sum = (pick: (r: TeacherWork["rows"][number]) => number) => data.rows.reduce((s, r) => s + pick(r), 0);
  const lesson = data.rows.filter((r) => r.reportSource === "lesson");
  const lessonSum = (pick: (r: TeacherWork["rows"][number]) => number) => lesson.reduce((s, r) => s + pick(r), 0);
  // 강사 수 = 담임이 있는 열의 사람(담임 없는 반 '미지정' 열은 사람이 아니다 · 한 사람의 과목 열이 둘이면 한 명).
  const teachers = new Set(data.rows.flatMap((r) => (r.teacherId ? [r.teacherId] : []))).size;
  const span = (from?: string, to?: string) => (from && to ? `${from.slice(5).replace("-", "/")}~${to.slice(5).replace("-", "/")}` : "");
  const tiles: { label: string; value: string; note?: string; alert?: boolean }[] = [
    { label: "강사", value: `${teachers.toLocaleString("ko-KR")}명`, note: `담당 반 ${sum((r) => r.classIds.length).toLocaleString("ko-KR")}개` },
    { label: "보고서 작성", value: workRatio(sum((r) => r.reports), sum((r) => r.reportTarget)), note: span(data.reportFrom, data.to) },
    ...(data.deliveryShown === true ? [
      { label: "발송 확인(안 나간 것)", value: workRatio(lessonSum((r) => Math.max(0, r.reports - r.sent - r.recalled)), lessonSum((r) => r.reports)), alert: lessonSum((r) => Math.max(0, r.reports - r.sent - r.recalled)) > 0 },
      { label: "학부모 미확인", value: workRatio(lessonSum((r) => r.unread), lessonSum((r) => r.unreadJudged)), note: span(data.unreadFrom, data.to) },
    ] : []),
    { label: "출결 미입력", value: workRatio(sum((r) => r.attendanceUnrecorded), sum((r) => r.attendanceDays)), note: span(data.attendanceFrom, data.attendanceTo), alert: sum((r) => r.attendanceUnrecorded) > 0 },
    { label: "영상 제출", value: workRatio(sum((r) => r.videoSubmitted), sum((r) => r.videoAssigned)), note: span(data.videoFrom, data.to) },
    { label: "영상 숙제 출제율", value: workRatio(lessonSum((r) => r.videoIssuedReports), lessonSum((r) => r.reportsWritten)) },
    ...(data.tasks ? [{ label: "미처리 업무", value: `${data.tasks.open.toLocaleString("ko-KR")}건`, note: data.tasks.late ? `기한 초과 ${data.tasks.late.toLocaleString("ko-KR")}` : undefined, alert: data.tasks.late > 0 }] : []),
  ];
  return <div className="space-y-4">
    <section aria-label="학원 전체 업무 현황" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => <div key={t.label} className="rounded-xl border p-4">
        <p className="text-text-dim text-xs">{t.label}</p>
        <p className={`mt-1 text-lg font-bold ${t.alert ? "text-danger" : ""}`}>{t.value}</p>
        {t.note ? <p className="text-text-dim mt-0.5 text-xs">{t.note}</p> : null}
      </div>)}
    </section>
    <Button variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "강사별 접기" : `강사별 보기 (${teachers.toLocaleString("ko-KR")}명)`}</Button>
    {open ? <div className="rounded-xl border p-4"><TeacherWorkCard data={data} subjects={subjects} /></div> : null}
  </div>;
}
