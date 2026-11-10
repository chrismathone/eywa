"use client";

import { toast } from "sonner";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import { stripImageSlots } from "@/features/report-templates/image-slots";
import { carryAttachmentLines } from "@/features/report-templates/attachment-lines";
import type { useEnglishJj } from "./use-english-jj";
import type { JjDayCache } from "../jj-day";
import type { EnglishJjStatus } from "./english-template-panel";
import type { JjExamPickState } from "./english-jj-exam-picker";
import { canRecompose, composeEnglishDraft, factTokensOf, outputAckKey, templateFactsKey, templateHashOf } from "../english-draft";
import { englishJjPick, englishJjSnapshot, englishJjStatus, englishRowFactsOf, englishRowFlagsOf } from "../english-row-facts";
import type { ReportsState } from "../session-input";
import type { useSheetT } from "@/features/teacher-view/lang-context";
import type { EnglishTemplateList, PatchReport } from "./english-template-types";

/**
 * 영어 행의 사실·경고 판정과 내보내기(발송·저장·복사) 전 확인·저장 직전 재조립·글 복사 — 수정 계획 P3-O batch C,
 * `use-english-template-mode.ts`에서 나눔. 판정 본문은 english-row-facts.ts(순수), 여기는 렌더 값·ref를 넘기는 얇은 함수와
 * 상태를 고치는 함수(확인 적기·재조립)다. 비동기 경로는 목록·캐시를 **ref**로 읽는다.
 */
export function useEnglishOutput({
  activeDate,
  report: { showDailyTest, showCheckTest, teacherName },
  jj,
  reportsRef,
  patchReport,
  templates: { templatesLoaded, templateListFailed, englishTemplatesRef, templatesLoadedRef, findTemplate },
  t,
}: {
  activeDate: string;
  report: { showDailyTest: boolean; showCheckTest: boolean; teacherName: string };
  jj: ReturnType<typeof useEnglishJj>;
  reportsRef: { readonly current: ReportsState };
  patchReport: PatchReport;
  templates: Omit<EnglishTemplateList, "templateListFailedRef">;
  t: ReturnType<typeof useSheetT>;
}) {
  // 영어 행의 사실(english-row-facts.ts) — 렌더는 state 캐시, 비동기 경로는 ref 캐시를 넘긴다.
  function englishFactsOf(student: OneScreenStudent, su: Subject, rep?: SubjectReport, jjCache: JjDayCache = jj.cache) {
    return englishRowFactsOf(student, su, rep, jjCache, { teacherName, showDailyTest, showCheckTest, activeDate });
  }
  function englishJjStatusOf(studentId: string): EnglishJjStatus {
    return englishJjStatus(jj, studentId, activeDate);
  }
  function englishJjPickOf(studentId: string): JjExamPickState | null {
    return englishJjPick(jj, studentId, activeDate);
  }
  function englishJjSnapshotOf(studentId: string) {
    return englishJjSnapshot(jj, studentId, activeDate);
  }
  /**
   * 미리보기에 실을 영어 글 — 템플릿 글 그대로면 **저장·복사 때 실제로 나갈 글**(지금 칸 값으로 다시 짠 글)을 보여 준다.
   * 렌더 중이라 상태는 바꾸지 않는다. 고친 글·가져온 글은 그대로("학부모가 받는 화면 그대로"가 거짓이 되지 않게).
   */
  function englishPreviewDraft(student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined): string {
    const found = findTemplate(rep?.templateId);
    if (!found || !canRecompose(found, rep)) return rep?.draft ?? "";
    // 강사가 넣은 사진·PDF 자리 줄은 다시 짠 글에도 그 자리에 따라온다(image-slots.ts carryAttachmentLines).
    return carryAttachmentLines(rep?.draft, composeEnglishDraft(found, englishFactsOf(student, su, rep), rep ?? {}));
  }
  // 경고 셋 — 판정 본문은 english-row-facts.ts(englishRowFlagsOf). 목록 상태는 렌더 값(state)이다.
  function englishRowFlags(student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined) {
    return englishRowFlagsOf(student, su, rep, { findTemplate, englishFactsOf, templatesLoaded, templateListFailed });
  }
  /**
   * '그대로 보낼/저장할/복사할까요?'에 **예**라고 답했으면 그 값으로 확인된 것으로 **따로 적는다**(outputAck) — 같은 값인
   * 동안 같은 확인을 되풀이하지 않고, 값이 또 바뀌면 다시 묻는다(손으로 고친 글에 풀리지 않는 확인이 매번 떠 OK만 누르게
   * 됐다). 🔴 지문·칩은 건드리지 않는다(english-draft `outputAckKey`). 화면 메모리에만 둔다(새로 열면 다시 묻는다).
   */
  function acknowledgeEnglishOutput(student: OneScreenStudent, su: Subject) {
    const rep = reportsRef.current[student.id]?.[su.name];
    if (!rep) return;
    const ack = outputAckKey(rep, englishFactsOf(student, su, rep));
    patchReport(student.id, su.name, (r) => ({ ...r, outputAck: ack }));
  }
  /** 이 영어 행의 템플릿을 아직 확인할 수 없다(목록이 오는 중) — 곧 다시 짤 수 있게 되니 내보내기를 잠깐 미룬다. */
  function englishTemplateNotReady(rep: SubjectReport | undefined): boolean {
    return (
      !!rep?.templateId && !templatesLoadedRef.current && !findTemplate(rep.templateId, englishTemplatesRef.current)
    );
  }
  /**
   * 영어 행을 내보내기 전(발송·저장·복사) 한 번 묻는다 — 글이 고치기 전 값을 담고 있을 때만(`outdated`, 판정 하나).
   * 예라고 하면 확인된 것으로 친다. @returns 계속해도 되면 true
   */
  function confirmEnglishOutput(
    student: OneScreenStudent,
    su: Subject | undefined,
    key: "os.tpl.outdatedSend" | "os.tpl.outdatedSave" | "os.tpl.outdatedCopy",
  ): boolean {
    if (!su || su.subjectKey !== "english") return true;
    const rep = reportsRef.current[student.id]?.[su.name];
    // 목록이 아직 오는 중이면 잠깐 미룬다 — 곧 다시 짤 수 있게 되는데 지금 '그대로'를 권하면 옛 글이 나간다.
    if (englishTemplateNotReady(rep)) {
      toast.message(t("os.tpl.loading"));
      return false;
    }
    if (!englishRowFlags(student, su, rep).outdated) return true;
    if (!window.confirm(t(key))) return false;
    acknowledgeEnglishOutput(student, su);
    return true;
  }
  /** 일괄 작업 대상 중 글이 고치기 전 값을 담은 영어 행(확인 창에 이름을 적는다). */
  function outdatedEnglishRows<T extends { student: OneScreenStudent; subject: Subject }>(rows: readonly T[]): T[] {
    return rows.filter(
      (r) =>
        r.subject.subjectKey === "english" &&
        englishRowFlags(r.student, r.subject, reportsRef.current[r.student.id]?.[r.subject.name]).outdated,
    );
  }
  /**
   * 🔴 템플릿이 마지막으로 만든 글 **그대로**면 지금 칸 값으로 다시 조립한다(저장·복사 직전). 자동작성 뒤 점수·숙제를
   *    고치면 글만 옛 값으로 남아 학부모 카드(/r)·복사본이 기록과 다른 말을 했다(적대 리뷰 2026-09-10).
   *    판정은 **지문**(templateHash) — 고친 글·'이전 회차 가져오기'로 넣은 글·옛 세션 글은 건드리지 않는다
   *    (`draft === autoDraft`로 판정했더니 가져온 글이 저장 때 조용히 사라졌다, 적대 재리뷰 2026-09-10).
   */
  function freshEnglishDraft(
    student: OneScreenStudent,
    subjectName: string,
  ): { draft: string; autoDraft: string | undefined } {
    const rep = reportsRef.current[student.id]?.[subjectName];
    const draft = rep?.draft ?? "";
    const su = student.subjects.find((x) => x.name === subjectName);
    const found = findTemplate(rep?.templateId, englishTemplatesRef.current);
    // AI 칸 템플릿인데 AI 글이 없으면 다시 짜지 않는다(코멘트 빠진 글이 저장·복사되지 않게 — canRecompose).
    if (!su || !found || !canRecompose(found, rep)) return { draft, autoDraft: rep?.autoDraft };
    const facts = englishFactsOf(student, su, rep, jj.cacheRef.current);
    const composed = composeEnglishDraft(found, facts, rep ?? {});
    // 강사가 넣은 사진·PDF 자리 줄은 따라온다 — 지문(templateHash)은 첨부 줄을 뺀 템플릿 글로 남긴다(english-draft.ts).
    const text = carryAttachmentLines(draft, composed);
    const factsKey = templateFactsKey(facts, rep?.nextTest ?? "", factTokensOf(found));
    if (text !== draft || rep?.composedFactsHash !== factsKey) {
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        autoDraft: text,
        templateHash: templateHashOf(composed),
        composedFactsHash: factsKey,
      }));
    }
    return { draft: text, autoDraft: text };
  }
  /**
   * 글 복사 — 영어 반 보드 자동 발송이 열리기 전까지 강사가 ClassNote에 붙여 넣는 **유일한** 길.
   * 🔴 복사가 실패하면 실패라고 말한다 — 성공 토스트만 띄우면 앞 학생 글이 클립보드에 남은 채 붙여 넣어진다.
   */
  async function copyEnglishText(student: OneScreenStudent, subjectName: string) {
    // 🔴 영어는 지금 '글 복사'가 학부모에게 닿는 **실제 경로**다(ClassNote 발송 과목이 아니다) — 발송 확인과 같은 판정으로 묻는다.
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!confirmEnglishOutput(student, su, "os.tpl.outdatedCopy")) return;
    // 그림 자리 줄(`[시험결과지]`)은 글자로 내보내지 않는다 — 대괄호가 학부모 글에 그대로 붙여 넣어지면 안 된다.
    // 🔴 복사 전엔 인재원을 **기다리지 않는다** — Safari는 클릭 처리 중에만 클립보드 쓰기를 허락해, 네트워크를 기다리면
    //    복사가 실패한다(적대 재리뷰). 복사 글은 그림 줄을 어차피 지우므로 받아 둔 자료로 충분하다.
    const text = stripImageSlots(freshEnglishDraft(student, subjectName).draft).trim();
    if (!text) {
      toast.message(t("os.tpl.copyEmpty"));
      return;
    }
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      toast.success(t("os.tpl.copied"));
    } catch {
      toast.error(t("os.tpl.copyFailed"));
    }
  }
  return {
    englishFactsOf,
    englishJjStatusOf,
    englishJjPickOf,
    englishJjSnapshotOf,
    englishPreviewDraft,
    englishRowFlags,
    englishTemplateNotReady,
    confirmEnglishOutput,
    outdatedEnglishRows,
    freshEnglishDraft,
    copyEnglishText,
  };
}
