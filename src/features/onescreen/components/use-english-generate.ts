"use client";

import { toast } from "sonner";
import { buildReportCommentInput } from "../report-comment";
import type { OneScreenStudent, Subject } from "../types";
import { generateEnglishMent } from "../server/english-ment-actions";
import { DEFAULT_ENGLISH_TEMPLATE } from "@/features/report-templates/defaults";
import { progressWithMode } from "../progress-mode";
import { carryAttachmentLines, hasTextBesidesAttachments, withoutAttachmentLines } from "@/features/report-templates/attachment-lines";
import { englishTestText } from "@/features/report-templates/values";
import type { useEnglishJj } from "./use-english-jj";
import {
  aiFactsHashOf,
  composeEnglishDraft,
  factTokensOf,
  isUntouchedTemplateDraft,
  templateHashOf,
  templateFactsKey,
  templateCarriesNote,
  templateImageSlots,
  monthlyScoresMissing,
  templateNeedsAi,
  type EnglishGenStatus,
} from "../english-draft";
import { resolveRowFields } from "../row-fields";
import { detectClassNotices } from "../class-notice";
import type { useSheetT } from "@/features/teacher-view/lang-context";
import type { ReportsState } from "../session-input";
import type { EnglishFactsOf, EnglishTemplateList, PatchReport } from "./english-template-types";

/**
 * 영어 행 템플릿 글 만들기(자동작성)·다시 채우기 본문 — 수정 계획 P3-O batch C, `use-english-template-mode.ts`에서 나눔(본문 그대로).
 * 다시 채우기 연타 막기·로딩 표시는 use-auto-write.ts가 이 두 함수를 감싼다. 기다린 뒤엔 ref로 **지금** 값을 읽는다.
 */
export function useEnglishGenerate({
  activeDate,
  classNarratives,
  jj,
  refs: { reportsRef, studentsRef },
  patchReport,
  rowOutOfClass,
  templates: { englishTemplatesRef, templatesLoadedRef, templateListFailedRef, findTemplate },
  englishFactsOf,
  t,
}: {
  activeDate: string;
  /** 반 공통 서술(G6) — 반 id → 서술. */
  classNarratives: Record<string, string>;
  jj: ReturnType<typeof useEnglishJj>;
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  patchReport: PatchReport;
  rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  templates: Pick<EnglishTemplateList, "englishTemplatesRef" | "templatesLoadedRef" | "templateListFailedRef" | "findTemplate">;
  englishFactsOf: EnglishFactsOf;
  t: ReturnType<typeof useSheetT>;
}) {
  /**
   * 영어 행 자동작성 — AI 인사말·코멘트를 받아 고른 템플릿에 채운다. 결과를 **상태로 돌려준다**
   * (일괄 작성은 `quiet`로 부르고 토스트를 모아서 한 번에 알린다).
   */
  async function generateEnglishDraftFor(
    student: OneScreenStudent,
    su: Subject,
    quiet = false,
  ): Promise<EnglishGenStatus> {
    const subjectName = su.name;
    const rep0 = reportsRef.current[student.id]?.[subjectName];
    // 대기 중인 선택(AI 글이 없어 아직 글에 못 쓴 템플릿)이 있으면 그것으로 — 자동작성이 그 선택을 완성한다.
    const found0 = findTemplate(rep0?.pendingTemplateId ?? rep0?.templateId, englishTemplatesRef.current);
    // 목록을 받기 전·못 받았을 땐 사용자 템플릿이 "없다"고 단정하지 않는다 — 기본 템플릿으로 바꿔 끼우면 고른 템플릿이
    // 조용히 사라진다(적대 재리뷰 2026-09-10). 기다렸다(또는 새로 고친 뒤) 다시 누르게 한다.
    if (!found0 && (!templatesLoadedRef.current || templateListFailedRef.current)) {
      if (!quiet) toast.message(t(templateListFailedRef.current ? "os.tpl.listFailedRetry" : "os.tpl.loading"));
      return "loading";
    }
    const draftBefore = rep0?.draft ?? "";
    // 🔴 고친 글(템플릿 글 그대로가 아님)을 자동작성이 말없이 덮지 않는다 — 다시 채우기와 같은 확인(일괄 작성은 글 있는
    //    행을 애초에 건너뛴다). 'AI 코멘트 옛 값' 경고의 해법이 곧 자동작성이라 더 중요하다(적대 재리뷰 2026-09-10).
    if (
      !quiet &&
      // 사진·PDF 줄만 있는 행은 '고친 글'이 아니다 — 묻지 않는다(그 줄은 새 글에 따라온다).
      hasTextBesidesAttachments(draftBefore) &&
      !isUntouchedTemplateDraft(rep0) &&
      !window.confirm(t("os.tpl.autoOverwriteConfirm"))
    ) {
      return "cancelled";
    }
    // 그림 칸 템플릿이면 인재원 하루치를 AI와 **나란히** 받는다(기다림을 늘리지 않게) — 조립 전에 기다린다.
    // 🔴 자동작성은 **항상 새로** 받는다(force) — 카드를 수업 전에 열어 둔 채면 수업 중 본 시험이 빠진다(적대 리뷰 2026-09-11).
    const jjOpts = { outOfClass: rowOutOfClass(student, su), force: true };
    let jjReady = templateImageSlots(found0 ?? DEFAULT_ENGLISH_TEMPLATE).length ? jj.ensure(student.id, jjOpts) : null;
    let ai: { intro: string; comment: string; factsHash: string } | null = null;
    // 템플릿에 AI 칸이 하나도 없으면 AI를 부르지 않는다(헛돈 쓰지 않게).
    if (templateNeedsAi(found0 ?? DEFAULT_ENGLISH_TEMPLATE)) {
      const idx = student.subjects.indexOf(su);
      // 🔴 반 전체 안내를 개인 관찰과 갈라 준다 — 수학 자동작성과 **같은 모집단**(지금 화면의 로스터 전체)으로
      //    판정한다(class-notice.ts). 안 가르면 한 반 글이 서로 복사본이 된다(2026-08-13 실측).
      const classNotices = detectClassNotices(
        studentsRef.current.flatMap((st) =>
          st.subjects.map((row) => ({ classId: row.classId, note: resolveRowFields(st, row).note })),
        ),
      );
      const base = buildReportCommentInput(student, idx, classNotices); // 태도·과제·특이사항 — 수학과 같은 층
      const facts = englishFactsOf(student, su);
      const nextTest = rep0?.nextTest ?? "";
      try {
        const res = await generateEnglishMent({
          studentName: student.name,
          // 복습·문제풀이 한 줄까지(aiFactsOf와 같은 값) — AI가 "진도를 나갔다"고 거꾸로 쓰지 않게(원장 2026-10-26).
          progress: progressWithMode(facts.progress, facts.progressMode),
          homeworkToday: facts.homeworkToday,
          testText: englishTestText({ daily: facts.dailyTest, check: facts.checkTest }),
          nextTest,
          attitude: base.attitude,
          homework: base.homework,
          // 템플릿이 특이사항을 '사랑의 한마디'로 원문 그대로 싣는다면 AI엔 안 준다(두 번 나가지 않게, templateCarriesNote).
          specialNote: templateCarriesNote(found0 ?? DEFAULT_ENGLISH_TEMPLATE) ? "" : base.specialNote,
          classContext: (su.classId && classNarratives[su.classId]) || "",
          classNotice: base.classNotice ?? "",
        }, { studentId: student.id, reportDate: activeDate }); // 직전 보고서 표현을 피하는 재료(원장 2026-10-26)
        // 지문은 **보낸 사실**로 남긴다 — 기다리는 동안 점수가 바뀌면 곧바로 'AI 코멘트가 옛 값 기준'이 뜬다.
        if (res.ok) ai = { intro: res.intro, comment: res.comment, factsHash: aiFactsHashOf(facts, nextTest) };
      } catch {
        // 아래에서 알린다
      }
      if (!ai) {
        // 🔴 AI가 실패하면 **글을 건드리지 않는다** — 코멘트 빈 글이 발송 게이트(멘트 필수)를 통과해 나가면 안 되고,
        //    지난 AI 코멘트를 ""로 덮어 되살릴 길을 없애서도 안 된다(적대 리뷰 2026-09-10).
        if (!quiet) toast.message(t("os.tpl.aiFailed"));
        return "ai_failed";
      }
    }
    // AI를 기다리는 동안 그림 칸 템플릿으로 바꿨으면 지금 받는다 — 클릭 때 템플릿으로만 판정하면 그림이 빠진다(적대 리뷰).
    if (!jjReady) {
      const repMid = reportsRef.current[student.id]?.[subjectName];
      const tplMid = findTemplate(repMid?.pendingTemplateId ?? repMid?.templateId, englishTemplatesRef.current);
      if (templateImageSlots(tplMid ?? DEFAULT_ENGLISH_TEMPLATE).length) jjReady = jj.ensure(student.id, jjOpts);
    }
    // 인재원 하루치 — 실패해도 글은 짠다(모르는 그림 칸은 기준 글 그대로 = 중립, slotFactsFor).
    if (jjReady) await jjReady;
    const nowRep = reportsRef.current[student.id]?.[subjectName];
    // 🔴 만드는 동안 강사가 **직접** 고쳤으면 글은 덮지 않는다(다시 채우기의 확인과 같은 원칙). 저장 직전 재조립처럼
    //    템플릿 글 그대로 바뀐 것은 고친 게 아니다(지문으로 가른다).
    // 사진·PDF 줄만 넣은 것은 고친 게 아니다(문장만 비교한다) — 그 줄은 아래 carryAttachmentLines가 새 글에 옮겨 심는다.
    if (
      withoutAttachmentLines(nowRep?.draft ?? "") !== withoutAttachmentLines(draftBefore) &&
      !isUntouchedTemplateDraft(nowRep)
    ) {
      // AI 결과는 버리지 않되 **대기칸**에 둔다(버리면 같은 글을 또 돈 들여 만든다). 🔴 글에 든 AI 문장·지문은 그대로
      //    둬야 한다 — 새 지문을 바로 쓰면 옛 코멘트가 든 글이 'AI 코멘트 옛 값' 경고 없이 나간다(적대 재리뷰 2026-09-10).
      //    '다시 채우기'가 대기칸으로 채우고 지문을 옮긴다.
      if (ai) {
        const got = ai;
        patchReport(student.id, subjectName, (r) => ({ ...r, pendingAi: got }));
      }
      if (!quiet) toast.message(t("os.tpl.editedDuringGen"));
      return "edited";
    }
    // 조립은 **지금** 칸 값·템플릿으로 — 기다리는 동안 진도·다음 시간 테스트·템플릿이 바뀌었을 수 있다.
    const nowStudent = studentsRef.current.find((s) => s.id === student.id) ?? student;
    const nowSu = nowStudent.subjects.find((x) => x.name === subjectName) ?? su;
    const wantId = nowRep?.pendingTemplateId ?? nowRep?.templateId;
    const found = findTemplate(wantId, englishTemplatesRef.current);
    const templateId = found ? wantId : undefined;
    const aiIntro = ai ? ai.intro : nowRep?.aiIntro;
    const aiComment = ai ? ai.comment : nowRep?.aiComment;
    const aiFactsHash = ai ? ai.factsHash : nowRep?.aiFactsHash;
    const nowFacts = englishFactsOf(nowStudent, nowSu, nowRep, jj.cacheRef.current);
    const composed = composeEnglishDraft(found ?? DEFAULT_ENGLISH_TEMPLATE, nowFacts, {
      nextTest: nowRep?.nextTest,
      aiIntro,
      aiComment,
    });
    // 강사가 넣어 둔 사진·PDF 자리 줄은 새 글에도 따라온다(지문은 첨부 줄을 뺀 템플릿 글 — english-draft.ts).
    const text = carryAttachmentLines(nowRep?.draft, composed);
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      templateId,
      templateImplicit: undefined, // 글이 됐다 — 이제 강사의 템플릿이다
      draft: text,
      autoDraft: text, // 작성 방식 스냅샷(0214a) — 수학과 같은 규약
      templateHash: templateHashOf(composed),
      composedFactsHash: templateFactsKey(
        nowFacts,
        nowRep?.nextTest ?? "",
        factTokensOf(found ?? DEFAULT_ENGLISH_TEMPLATE),
      ),
      aiIntro,
      aiComment,
      aiFactsHash,
      pendingAi: undefined, // 새 AI 글이 들어갔으니 대기칸은 버린다
      pendingTemplateId: undefined, // 고른 템플릿이 글이 됐다
      // 🔴 새 글이다 — 앞선 '그대로' 확인은 옛 글에 대한 것이라 버린다(안 버리면 새 글이 확인 없이 나갔다, 적대 재리뷰).
      outputAck: undefined,
    }));
    // 월간 보고서인데 Monthly Test 점수가 없으면 코멘트만 들어간다 — 반응 없음처럼 보이지 않게 까닭을 알린다(2026-11-05).
    if (!quiet && monthlyScoresMissing(found ?? DEFAULT_ENGLISH_TEMPLATE, nowFacts)) toast.message(t("os.tpl.monthlyNoScores"));
    // AI를 안 부르는 템플릿(월간 보고서 등)은 눈 깜짝할 새 끝나 '눌렸나?'를 모른다 — 채웠다고 알린다(원장 2026-11-05 *"로딩이나 뭐 그런게없음 그래서 자꾸 누르게됌"*).
    else if (!quiet && found && !templateNeedsAi(found)) toast.success(t("os.tpl.filledNoAi"));
    if (found) return "ok";
    if (!quiet) toast.message(t("os.tpl.templateMissing"));
    return "template_fallback";
  }
  async function refillEnglishInner(student: OneScreenStudent, subjectName: string, templateId?: string) {
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!su) return;
    // 그림 칸 템플릿이면 인재원 하루치를 먼저 **새로** 받는다 — 모르는 채로(또는 수업 전에 받아 둔 옛 값으로) 채우면
    // 그림 줄이 지금 자료와 상관없이 정해진다(적대 리뷰 2026-09-11).
    const rep0 = reportsRef.current[student.id]?.[subjectName];
    const want = findTemplate(templateId ?? rep0?.pendingTemplateId ?? rep0?.templateId, englishTemplatesRef.current);
    if (want && templateImageSlots(want).length) {
      await jj.ensure(student.id, { outOfClass: rowOutOfClass(student, su), force: true });
    }
    const rep = reportsRef.current[student.id]?.[subjectName];
    const nextId = templateId ?? rep?.pendingTemplateId ?? rep?.templateId;
    const found = findTemplate(nextId, englishTemplatesRef.current);
    if (!found && (!templatesLoadedRef.current || templateListFailedRef.current)) {
      toast.message(t(templateListFailedRef.current ? "os.tpl.listFailedRetry" : "os.tpl.loading"));
      return;
    }
    const keptId = found ? nextId : undefined;
    const template = found ?? DEFAULT_ENGLISH_TEMPLATE;
    // 작성 중 수정으로 대기칸에 받아 둔 AI 글이 있으면 그것으로 채운다(지문도 함께 옮긴다).
    const pending = rep?.pendingAi;
    const ai = pending
      ? { aiIntro: pending.intro, aiComment: pending.comment, aiFactsHash: pending.factsHash }
      : { aiIntro: rep?.aiIntro, aiComment: rep?.aiComment, aiFactsHash: rep?.aiFactsHash };
    // 🔴 AI 칸이 있는 템플릿인데 AI 글을 한 번도 못 만든 행 — 사실 줄만 있는 글이 '멘트 있음'으로 발송 게이트를
    //    지나면 안 된다(AI 실패 때 글을 안 바꾸는 것과 같은 원칙, 적대 재리뷰 2026-09-10).
    // 🔴 글의 템플릿(templateId)은 **바꾸지 않는다** — 바꾸면 글·지문은 옛 템플릿인데 판정은 새 템플릿으로 해서, 그사이
    //    고친 점수를 못 알아보고 옛 값이 저장·복사됐다(적대 재리뷰). 고른 것은 대기(pendingTemplateId)로만 둔다.
    if (templateNeedsAi(template) && !ai.aiIntro?.trim() && !ai.aiComment?.trim()) {
      const pendingTemplateId = keptId === rep?.templateId ? undefined : keptId;
      patchReport(student.id, subjectName, (r) => ({ ...r, pendingTemplateId }));
      toast.message(t("os.tpl.needAiFirst"));
      return;
    }
    // 🔴 템플릿이 만든 글 그대로가 아니면(고친 글·가져온 글·옛 글) 먼저 묻는다 — 판정은 지문(english-draft.ts).
    const edited = hasTextBesidesAttachments(rep?.draft) && !isUntouchedTemplateDraft(rep);
    if (edited && !window.confirm(t("os.tpl.overwriteConfirm"))) return;
    if (!found) toast.message(t("os.tpl.templateMissing"));
    const facts = englishFactsOf(student, su, rep, jj.cacheRef.current);
    if (monthlyScoresMissing(template, facts)) toast.message(t("os.tpl.monthlyNoScores"));
    const composed = composeEnglishDraft(template, facts, {
      nextTest: rep?.nextTest,
      aiIntro: ai.aiIntro,
      aiComment: ai.aiComment,
    });
    // 사진·PDF 자리 줄은 다시 채워도 따라온다(덮기 확인은 문장을 고친 경우만 — 첨부 줄은 고친 글로 치지 않는다).
    const text = carryAttachmentLines(rep?.draft, composed);
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      templateId: keptId,
      templateImplicit: undefined,
      draft: text,
      autoDraft: text,
      templateHash: templateHashOf(composed),
      composedFactsHash: templateFactsKey(facts, rep?.nextTest ?? "", factTokensOf(template)),
      ...ai,
      pendingAi: undefined,
      pendingTemplateId: undefined,
      // 🔴 새 글이다 — 앞선 '그대로' 확인은 옛 글에 대한 것이라 버린다(다시 채우기로 옛 코멘트가 돌아와도 다시 묻는다).
      outputAck: undefined,
    }));
  }
  return { generateEnglishDraftFor, refillEnglishInner };
}
