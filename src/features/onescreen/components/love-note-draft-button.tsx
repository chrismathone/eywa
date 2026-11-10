"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { suggestLoveNote } from "../server/love-note-actions";
import { understandingLevelWord, type LoveNoteFacts } from "../love-note";
import { isMathReportPilot, lessonTitle, pilotLessons, understandingRows } from "../math-report-pilot";
import { formatTestScore } from "../report-comment";
import { resolveRowFields } from "../row-fields";
import type { OneScreenStudent, Subject } from "../types";

/**
 * 사랑의 한마디 **[초안]** 버튼(원장 2026-10-28) — 누르면 그날 입력값 + 이 선생님이 써 온 한마디·고친 방식으로 초안을 받아 칸에 넣는다.
 * 칸에 이미 글이 있으면 바꿀지 먼저 묻는다(선생님 글을 말없이 덮지 않는다). 표·카드가 같은 버튼을 쓴다.
 * 🔴 누를 때만 부른다(페이지 로드·자동작성에서 부르지 않는다).
 */
export function LoveNoteDraftButton({
  student,
  subject,
  value,
  onFill,
  disabled = false,
  compact = false,
}: {
  student: OneScreenStudent;
  subject: Subject;
  /** 지금 칸의 글 — 비었으면 바로 넣고, 있으면 바꿀지 묻는다. */
  value: string;
  onFill: (note: string) => void;
  disabled?: boolean;
  /** 표 모드(좁은 칸) — 글자를 작게. */
  compact?: boolean;
}) {
  const t = useSheetT();
  const date = useSearchParams()?.get("date") ?? "";
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy || disabled) return;
    if (value.trim() && !window.confirm(t("os.note.draftReplace"))) return;
    setBusy(true);
    try {
      const res = await suggestLoveNote({
        studentId: student.id,
        studentName: student.name,
        // 저장과 같은 과목 값(onescreen-client 저장: subjectKey || subjectLabel || name) — 지난 초안 ↔ 보낸 글을 같은 칸으로 짝짓는다.
        subject: subject.subjectKey || subject.subjectLabel || subject.name,
        reportDate: date,
        facts: loveNoteFactsOf(student, subject),
      });
      if (res.ok) onFill(res.note);
      else toast.error(res.error);
    } catch {
      toast.error(t("os.note.draftFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={disabled || busy}
      aria-busy={busy}
      title={t("os.note.draftTitle")}
      className={`border-primary text-primary hover:bg-primary/10 shrink-0 rounded-md border font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"
      }`}
    >
      {busy ? t("os.note.draftBusy") : t("os.note.draft")}
    </button>
  );
}

/** 화면 행 값 → 초안 재료. 이해도는 선생님이 **매긴** 소단원만(안 매긴 기본값 10은 사실이 아니다). */
function loveNoteFactsOf(student: OneScreenStudent, subject: Subject): LoveNoteFacts {
  const ev = resolveRowFields(student, subject);
  const daily = ev.tests.daily;
  const pilot = isMathReportPilot(student.id, subject.subjectKey);
  const lessons = pilot ? pilotLessons(subject.today).map(lessonTitle).filter(Boolean) : [];
  return {
    attitude: ev.attitude ?? "",
    dailyTest: subject.dailyTestSkip ? "시험 없음" : daily.score != null ? formatTestScore(daily.score, daily.max) : "",
    homework: ev.homework ?? "",
    progress: lessons.length ? lessons.join(", ") : (subject.today ?? ""),
    understanding: pilot
      ? understandingRows(subject.today, subject.understanding)
          // stored면 점수가 저장된 줄이라 null이 아니다 — 타입만 좁힌다(동작 같음).
          .flatMap((r) => (r.stored && !r.off && r.score != null ? [{ title: r.title, level: understandingLevelWord(r.score) }] : []))
      : [],
  };
}
