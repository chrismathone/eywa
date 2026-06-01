"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ATTITUDE, CLASS_TAGS, TODAY } from "../data";
import { buildReport, isStudentDone } from "../report";
import type { OneScreenStudent } from "../types";
import { OneScreenTopBar } from "./top-bar";
import { StudentList } from "./student-list";
import { ProgressCard } from "./progress-card";
import { TestCard } from "./test-card";
import { ReportCard } from "./report-card";

/**
 * 선생님 원스크린 메인 — 상태는 전부 클라이언트 state(새로고침 시 초기화).
 * 데모 충실 이식이라 DB 영속화/네트워크 없음. 보고서는 템플릿(buildReport),
 * 발송은 sonner 토스트 목업.
 */
export function OneScreenClient({ initial }: { initial: OneScreenStudent[] }) {
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [selId, setSelId] = useState<string>(initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>("전체");

  const visible =
    classFilter === "전체" ? students : students.filter((s) => s.tag === classFilter);

  // 필터로 선택 학생이 사라지면 보이는 첫 학생으로 폴백 (effect 없이 파생)
  const effectiveId = visible.some((s) => s.id === selId) ? selId : (visible[0]?.id ?? "");
  const selected = visible.find((s) => s.id === effectiveId) ?? null;
  const doneCount = students.filter(isStudentDone).length;

  function patch(id: string, fn: (s: OneScreenStudent) => OneScreenStudent) {
    setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }

  function confirmProgress() {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, progressConfirmed: !s.progressConfirmed }));
  }

  function setScore(which: "daily" | "check", v: number | null) {
    if (!selected) return;
    patch(selected.id, (s) => ({
      ...s,
      tests: { ...s.tests, [which]: { ...s.tests[which], score: v } },
    }));
  }

  function setAttitude(a: string) {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, attitude: s.attitude === a ? null : a }));
  }

  function setDraft(text: string) {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, reportDraft: text }));
  }

  function autoWrite() {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, reportDraft: buildReport(s) }));
  }

  function send(channel: string) {
    if (!selected) return;
    const { id, name } = selected;
    // 초안이 비어 있으면 자동 작성 후 발송 (프로토타입 동작)
    patch(id, (s) => ({
      ...s,
      reportDraft: s.reportDraft.trim() ? s.reportDraft : buildReport(s),
      reportSent: true,
    }));
    const msg =
      channel === "pdf"
        ? "보고서를 PDF로 내보냈습니다"
        : channel === "save"
          ? "내부 기록에 저장했습니다"
          : `${name} 학부모님께 ${channel} 발송했습니다`;
    toast.success(msg);
  }

  return (
    <div className="space-y-4">
      <OneScreenTopBar
        today={TODAY}
        classTags={CLASS_TAGS}
        classFilter={classFilter}
        onFilter={setClassFilter}
        doneCount={doneCount}
        total={students.length}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,380px)]">
        <StudentList students={visible} selId={effectiveId} onSelect={setSelId} />

        {selected ? (
          <>
            <div className="flex flex-col gap-4">
              <ProgressCard student={selected} onConfirm={confirmProgress} />
              <TestCard student={selected} onScore={setScore} />
            </div>
            <ReportCard
              student={selected}
              attitudes={ATTITUDE}
              onAttitude={setAttitude}
              onDraft={setDraft}
              onAutoWrite={autoWrite}
              onSend={send}
            />
          </>
        ) : (
          <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm lg:col-span-2">
            학생을 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
