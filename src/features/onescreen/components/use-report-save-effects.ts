"use client";

import { toast } from "sonner";
import { monthDayLabel } from "@/lib/date-kst";
import type { SavedVideoHomeworkDue } from "@/features/video-homework/due";
import type { OneScreenStudent } from "../types";
import type { useVideoHomeworkStore } from "@/features/video-homework/components/video-homework-provider";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 저장 응답을 화면에 되돌리는 일 — 진도 확정·영상 과제를 작성 선생님 값으로·서버가 정한 영상 숙제 마감.
 * 수정 계획 P3-O batch D, `use-send-core.ts`에서 나눔(본문 그대로). 저장·발송·첨부 자동저장이 응답마다 부른다.
 * 학생 값은 **부를 때** ref에서 읽는다(응답이 늦게 와도 지금 줄을 고친다).
 */
export function useReportSaveEffects({
  studentsRef,
  i18n: { t, tf },
  videoHwStore,
  patch,
}: {
  studentsRef: { readonly current: OneScreenStudent[] };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  videoHwStore: ReturnType<typeof useVideoHomeworkStore>;
  patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
}) {
  // 보고서 저장 시 그 학생 진도를 확정 처리 — 표 모드엔 카드의 '진도 확정' 버튼이 없어 상단 진도·마감 지표가
  // 0에 고정되던 문제(#13). 이미 확정이면 no-op(불필요한 autosave 방지).
  function confirmProgressOnSave(studentId: string) {
    const cur = studentsRef.current.find((s) => s.id === studentId);
    if (cur && !cur.progressConfirmed) patch(studentId, (s) => ({ ...s, progressConfirmed: true }));
  }
  /**
   * 서버가 '영상 과제' 값을 작성 선생님 것으로 두었다(report-owner.ts — 나머지는 저장됨) → 화면도 그 값으로 되돌린다.
   * 🔴 안 되돌리면 세션(임시저장)이 내 값을 쥐고 있어 새로 고쳐도 같은 값이 다시 실린다(적대 리뷰). patch가 세션도 고친다.
   */
  function applyKeptVideoHomework(studentId: string, subjectName: string,
    res: { ok?: boolean; keptVideoHomework?: boolean | null; videoHomeworkCancelled?: true; videoHomeworkSeenAt?: string }) {
    if (res.keptVideoHomework === undefined) return;
    const kept = res.keptVideoHomework;
    const keptClassId = studentsRef.current.find((s) => s.id === studentId)?.subjects.find((x) => x.name === subjectName)?.classId;
    const cancelled = !!res.videoHomeworkCancelled;
    if (cancelled) {
      // 장부에서 취소된 숙제(원장 2026-10-16) — 줄은 잠그지 않는다(다시 켜면 그때부터 선생님 값이다). 그 줄의 맞춘 시각을 응답 시각으로 옮긴다.
      if (keptClassId && res.videoHomeworkSeenAt) videoHwStore?.markSeen(studentId, keptClassId, res.videoHomeworkSeenAt);
      // 발송 경로는 서버 문장("보내지 않았습니다")이 따로 뜬다 — 저장만 한 경로에서만 알린다.
      if (res.ok) toast.message(t("os.c.videoHwCancelled"));
    } else {
      // 화면 겹(토글 잠금)을 지나 여기 온 건 그사이 남이 먼저 쓴 경우뿐이라 드물다 — 일괄 저장이어도 행마다 알린다.
      toast.message(t("os.c.videoHwKept"));
      // 그 줄을 잠금에 더한다 — 열어 두면 다시 눌러 또 되돌려진다(잠긴 줄의 체크 표시는 공급자의 저장된 값).
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, kept);
    }
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) =>
        // 모름(null)은 화면 모양대로 undefined — 세션에서도 빠져 저장된 값(모름)을 따른다. 취소된 숙제는 마감 고르기도 비운다.
        x.name === subjectName ? { ...x, videoHomework: kept ?? undefined, ...(kept !== true ? { videoSubmitLink: false } : {}),
          ...(cancelled ? { videoHomeworkDue: undefined, videoHomeworkDueDate: undefined } : {}) } : x,
      ),
    }));
  }
  /**
   * 서버가 정한 영상 숙제 마감(원장 2026-10-15, due-write.ts) — '다음 수업' 날짜를 표시에 싣는다. 고른 것과 다르게 됐으면(7일로 됨 · 남이 쓴 줄)
   * 토글을 저장값으로 되돌리고 까닭을 학생 이름과 함께 알린다(일괄 저장이면 여러 줄이 뜬다 — 누구인지 보이게). 세션도 따라 고쳐진다
   * (고른 값이 남아 다음 저장에 또 실리지 않게). 남이 쓴 줄은 영상 과제와 같이 잠근다. 이 줄은 발송되지 않았다(saveAndQueueClassnote).
   */
  function applyVideoHomeworkDue(studentId: string, subjectName: string, res: { videoHomeworkDue?: SavedVideoHomeworkDue }) {
    const saved = res.videoHomeworkDue;
    if (!saved) return;
    const row = studentsRef.current.find((s) => s.id === studentId);
    const name = row?.name ?? "";
    if (saved.kept) {
      toast.message(tf("os.c.videoDueKept", { name }));
      const keptClassId = row?.subjects.find((x) => x.name === subjectName)?.classId;
      const keptVideo = row?.subjects.find((x) => x.name === subjectName)?.videoHomework;
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, keptVideo ?? null);
    } else if (saved.fellBack === "none") toast.message(tf("os.c.videoDueFallback", { name }));
    else if (saved.fellBack === "past") toast.message(tf("os.c.videoDuePast", { name, date: saved.missed ? monthDayLabel(saved.missed) : "" }));
    else if (saved.fellBack === "error") toast.error(tf("os.c.videoDueError", { name }));
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, videoHomeworkDue: saved.mode, videoHomeworkDueDate: saved.date ?? undefined } : x)),
    }));
  }
  return { confirmProgressOnSave, applyKeptVideoHomework, applyVideoHomeworkDue };
}
