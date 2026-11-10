"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { buildReportCommentInput, rowMakeupFacts } from "../report-comment";
import { buildReportFields } from "../report-fields";
import { isJjSheetReport } from "../jj-books";
import { isBuiltinTemplateId, revertImplicit, type TemplatePrefs } from "../last-template";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import { generateEnglishMent } from "../server/english-ment-actions";
import { listMyReportTemplates } from "@/features/report-templates/server/actions";
import { BUILTIN_ENGLISH_TEMPLATES, DEFAULT_ENGLISH_TEMPLATE, type ReportTemplate } from "@/features/report-templates/defaults";
import { attendanceSentence } from "../attendance-sentence";
import { progressWithMode } from "../progress-mode";
import { stripImageSlots } from "@/features/report-templates/image-slots";
import { carryAttachmentLines, hasTextBesidesAttachments, withoutAttachmentLines } from "@/features/report-templates/attachment-lines";
import { englishTestText } from "@/features/report-templates/values";
import type { useEnglishJj } from "./use-english-jj";
import { jjDayKey, jjDaySummary, jjKnownSlots, type JjDayCache } from "../jj-day";
import type { EnglishJjStatus } from "./english-template-panel";
import type { JjExamPickState } from "./english-jj-exam-picker";
import {
  aiFactsHashOf,
  canRecompose,
  composeEnglishDraft,
  findTemplateIn,
  factTokensOf,
  isAiStale,
  isNameMissing,
  isTemplateStale,
  isTextOutdated,
  isUntouchedTemplateDraft,
  templateHashOf,
  needsAiFirst,
  outputAckKey,
  pendingNeedsAi,
  slotFactsFor,
  templateFactsKey,
  templateCarriesNote,
  templateImageSlots,
  monthlyScoresMissing,
  templateNeedsAi,
  type EnglishGenStatus,
  type EnglishRowFacts,
} from "../english-draft";
import { resolveRowFields } from "../row-fields";
import { detectClassNotices } from "../class-notice";
import type { ReportsState } from "../session-input";
import type { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 영어 템플릿 모드(2026-09-10) — 수정 계획 P3-O 7/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 내 템플릿 목록(영어 행이 있을 때만 한 번 받는다)·목록 상태·템플릿 관리 창·반별 기본 템플릿(templatePrefsRef)과,
 * 영어 행의 사실·글 판정(옛 값 기준인가 · 내보내기 전 확인)·템플릿 글 만들기·다시 채우기 본문·글 복사를 낸다.
 * 비동기 경로(일괄 자동작성·저장·복사)는 목록을 **ref**로 읽는다 — 루프 중 도착한 목록도 다음 행부터 본다.
 * 다시 채우기 연타 막기·자동작성 로딩 표시는 use-auto-write.ts, 템플릿 고르기(setEnglishTemplateFor)는 화면에 있다.
 */
export function useEnglishTemplateMode({
  students,
  initialTemplatePrefs,
  activeDate,
  report: { showDailyTest, showCheckTest, teacherName },
  classNarratives,
  jj,
  refs: { reportsRef, studentsRef },
  state: { setReports, patchReport },
  rowOutOfClass,
  t,
}: {
  students: OneScreenStudent[];
  initialTemplatePrefs: TemplatePrefs;
  activeDate: string;
  /** 영어 글 사실 줄 재료 — 테스트 사용 여부 · 담당자 이름. */
  report: { showDailyTest: boolean; showCheckTest: boolean; teacherName: string };
  /** 반 공통 서술(G6) — 반 id → 서술. */
  classNarratives: Record<string, string>;
  /** 영어 행의 인재원 하루치(use-english-jj.ts) — 화면과 같은 캐시를 쓴다. */
  jj: ReturnType<typeof useEnglishJj>;
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  state: {
    setReports: Dispatch<SetStateAction<ReportsState>>;
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
  };
  rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  t: ReturnType<typeof useSheetT>;
}) {
  // 영어 템플릿 모드(2026-09-10) — 내 템플릿 목록(맨 앞은 기본). **영어 행이 있을 때만** 한 번 불러온다
  // (첫 페인트 밖 · 수학만 가르치는 강사는 호출 0). 실패해도 기본 템플릿은 그대로 쓴다.
  const [englishTemplates, setEnglishTemplates] = useState<ReportTemplate[]>(() => [...BUILTIN_ENGLISH_TEMPLATES]);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  // 목록을 한 번이라도 받았는가(성공·실패 무관) — 받기 전엔 사용자 템플릿을 "없다"고 단정하지 않는다.
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // 영어 템플릿 내 기본값(반별 마지막 선택) — 고를 때마다 바뀐다. 새로 세우는 행(보강 추가 등)이 지금 값을 쓴다.
  const templatePrefsRef = useRef<TemplatePrefs>(initialTemplatePrefs);
  const [templateListFailed, setTemplateListFailed] = useState(false);
  const hasEnglishRows = useMemo(
    () => students.some((s) => s.subjects.some((su) => su.subjectKey === "english")),
    [students],
  );
  useEffect(() => {
    if (!hasEnglishRows) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listMyReportTemplates();
        if (cancelled) return;
        setEnglishTemplates(res.templates);
        setTemplateNotice(res.notice);
        // 기본값으로 붙여 둔 사용자 템플릿이 목록에 없으면(지움) — 또는 목록이 불완전하면(notice) — 그 빈 행을 코드 기본 템플릿으로
        // 되돌린다. 🔴 안 되돌리면 목록 실패 한 번에 반 전체의 자동작성이 '템플릿 목록 실패'로 멈춘다(적대 리뷰 2026-10-27).
        //    강사가 직접 고른 행은 그대로 둔다(종전대로 알린다).
        const ids = new Set(res.notice ? [] : res.templates.map((tp) => tp.id));
        setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id) && !ids.has(id)));
        // 🔴 안내(notice)가 붙은 목록은 기본 템플릿뿐인 **불완전한** 목록이다(DB 오류·표 없음·권한) — 실패로 친다.
        //    안 치면 사용자 템플릿 행에 '삭제됨' 거짓 칩이 서고, 자동작성이 기본 템플릿으로 바꿔 끼워 선택을 잃었다(적대 재리뷰).
        if (res.notice) setTemplateListFailed(true);
      } catch {
        // 목록을 못 받아도 기본 템플릿으로 계속 쓸 수 있다 — 화면을 막지 않되 **알린다**
        // (말없이 기본으로 바꿔 끼우면 고른 템플릿과 다른 글이 나간다).
        if (!cancelled) {
          setTemplateListFailed(true);
          // 기본값으로만 붙여 둔 사용자 템플릿은 되돌린다(위와 같은 이유) — 강사가 고른 행은 그대로.
          setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id)));
        }
      } finally {
        if (!cancelled) setTemplatesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasEnglishRows, setReports]); // setReports는 늘 같은 함수(state 세터) — 예전 [hasEnglishRows]와 같게 돈다
  // 영어 템플릿 목록·로딩 여부 미러 — 일괄 자동작성(비동기 루프) 중 목록이 도착해도 다음 행부터 본다.
  const englishTemplatesRef = useRef(englishTemplates);
  const templatesLoadedRef = useRef(templatesLoaded);
  const templateListFailedRef = useRef(templateListFailed);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs).
  useEffect(() => {
    englishTemplatesRef.current = englishTemplates;
    templatesLoadedRef.current = templatesLoaded;
    templateListFailedRef.current = templateListFailed;
  });
  /**
   * 이 행이 고른 템플릿. 없거나 지워졌으면 **null** — 호출부가 기본 템플릿으로 채우되 그 사실을 알린다
   * (말없이 다른 템플릿으로 바꿔 끼우면 강사가 고른 것과 다른 글이 나간다, 적대 리뷰 2026-09-10).
   * ⚠️ 비동기 경로(자동작성·저장·복사)는 `englishTemplatesRef.current`를 넘긴다 — 일괄 작성 중 도착한 목록도 본다.
   */
  function findTemplate(
    templateId: string | undefined,
    list: readonly ReportTemplate[] = englishTemplates,
  ): ReportTemplate | null {
    return findTemplateIn(list, templateId, DEFAULT_ENGLISH_TEMPLATE);
  }
  /**
   * 영어 행의 사실 — 표시 필드는 저장(buildReportFields)과 **같은 함수**로 만들고(오늘 과제 쪽수 후보정·테스트 표기)
   * 평가값은 행 단위(row-fields.ts)로 읽는다. 템플릿 글과 AI 지문이 모두 이 값에서 나온다.
   */
  function englishFactsOf(
    student: OneScreenStudent,
    su: Subject,
    // 그림 칸 판정의 기준 글(자동 글 → 지금 글) — 인재원 자료를 아직 모를 때 중립으로 두는 데 쓴다(slotFactsFor).
    rep?: SubjectReport,
    // 렌더는 state, 비동기 경로(저장 직전 재조립·자동작성)는 ref를 넘긴다(use-english-jj.ts).
    jjCache: JjDayCache = jj.cache,
  ): EnglishRowFacts {
    const rowEval = resolveRowFields(student, su);
    const fields = buildReportFields({
      subject: su,
      homework: rowEval.homework,
      attitude: rowEval.attitude,
      tests: rowEval.tests,
      draft: "",
      jjSheet: isJjSheetReport(rep),
      showDailyTest,
      showCheckTest,
    });
    return {
      studentName: student.name,
      teacherName,
      progress: su.today ?? "",
      progressMode: su.progressMode ?? null,
      homeworkToday: fields.homeworkToday,
      dailyTest: fields.dailyTest,
      checkTest: fields.checkTest,
      attitude: rowEval.attitude ?? "",
      homework: rowEval.homework,
      note: rowEval.note,
      // 출결(원장 2026-10-26) — 출석부 칸 그대로(수학 보고서와 같은 문장, attendance-sentence.ts).
      // 보강 줄이면 결석 날짜·시간·사유를 붙인다(2026-10-26 — 수학과 같은 재료, report-comment.ts rowMakeupFacts).
      attendance: attendanceSentence(su.attendanceRaw, su.attendanceNote, rowMakeupFacts(student, su)),
      // EiE 월간 보고서 점수(2026-11-05) — 로스터가 실어 둔 그 반 Monthly Test(english-monthly.ts).
      monthly: su.monthlyEval ?? null,
      // 그 달 숙제·태도·단어 테스트(2026-11-06, EiE 월간 보고서) — 로스터가 EiE 반에만 싣는다.
      monthlyActivity: su.monthlyActivity ?? null,
      // EiE 일일 보고서(2026-11-06) — 행 보고서 값(재시험 체크 · 단어 테스트 피드백).
      wordRetest: rep?.wordRetest === true,
      wordFeedback: rep?.wordFeedback ?? "",
      slots: slotFactsFor(
        jjKnownSlots(jjCache[jjDayKey(student.id, activeDate)]),
        rep?.autoDraft ?? rep?.draft ?? "",
      ),
    };
  }
  /** 패널 한 줄 요약 재료 — 아직 안 받았으면 '불러오는 중'(카드를 열면 곧 받는다). */
  function englishJjStatusOf(studentId: string): EnglishJjStatus {
    const key = jjDayKey(studentId, activeDate);
    const st = jj.cache[key];
    // 다시 받는 중이면 옛 요약 대신 '불러오는 중' — 다시 채우기·새로 고침을 눌렀는데 아무 일도 없어 보이지 않게(적대 리뷰).
    if (!st || jj.pending.has(key)) return { kind: "loading" };
    if (st.status === "unlinked") return { kind: "unlinked" };
    if (st.status === "error") return { kind: "error", detail: st.message };
    const sum = jjDaySummary(st);
    return { kind: "ok", exams: sum?.exams ?? 0, answers: sum?.answers ?? 0 };
  }
  /** 결과지 고르기 재료 — 받은 자료가 있을 때만. 받는 중이면 잠근다(옛 목록 위에서 고르기가 계산되지 않게). */
  function englishJjPickOf(studentId: string): JjExamPickState | null {
    const key = jjDayKey(studentId, activeDate);
    const st = jj.cache[key];
    if (st?.status !== "ok") return null;
    return {
      options: st.options ?? [],
      pick: st.snapshot.pick ?? null,
      date: activeDate,
      busy: jj.pending.has(key),
    };
  }
  /** 미리보기에 실을 인재원 자료(받은 것만) — 발송본은 저장 때 서버가 다시 받은 것으로 그린다. */
  function englishJjSnapshotOf(studentId: string) {
    const st = jj.cache[jjDayKey(studentId, activeDate)];
    return st?.status === "ok" ? st.snapshot : null;
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
  /** 경고 셋(칸 달라짐·AI 코멘트가 옛 값 기준·이름 없음) — 카드 칸·표 행·발송 확인이 같은 판정을 쓴다. */
  function englishRowFlags(student: OneScreenStudent, su: Subject, rep: SubjectReport | undefined) {
    const found = findTemplate(rep?.templateId);
    const template = found ?? DEFAULT_ENGLISH_TEMPLATE;
    const facts = englishFactsOf(student, su, rep);
    const aiStale = isAiStale(template, facts, rep);
    // 🔴 글이 옛 칸 값을 담고 있는데 저장·복사가 자동으로 못 맞추는가(템플릿 삭제·목록 실패·AI 글 없음·고친 글) —
    //    템플릿과 무관한 지문으로 판정한다(못 찾은 템플릿으로 판정하면 옛 점수가 경고 없이 나갔다, 적대 재리뷰).
    const textOutdated = isTextOutdated(found, facts, rep);
    return {
      stale: (!!found && isTemplateStale(found, facts, rep)) || textOutdated,
      aiStale,
      nameMissing: isNameMissing(template, rep, student.name),
      // 'AI 글 없음' = 글의 템플릿에 AI 칸이 새로 생겼거나(템플릿 편집) 고른 템플릿이 AI 글을 기다리는 중.
      // 템플릿을 못 찾았으면 판정하지 않는다(기본 템플릿으로 판정하면 거짓 칩이 선다) — 대신 '템플릿 없음'.
      needsAi:
        (!!found && needsAiFirst(found, rep)) ||
        pendingNeedsAi(rep?.pendingTemplateId ? findTemplate(rep.pendingTemplateId) : null, rep),
      // 글의 템플릿이 목록에서 사라졌다(삭제) — 목록을 제대로 받았을 때만 단정한다.
      templateGone: !!rep?.templateId && !found && templatesLoaded && !templateListFailed,
      // 내보내기(발송·저장·복사·링크) 전에 물을 조건 — 판정은 이것 하나. 강사가 같은 값에서 이미 '그대로'라고 답했으면
      // 다시 묻지 않는다(칩은 그대로 남는다 — 확인은 지문이 아니라 따로 적는다).
      outdated: (aiStale || textOutdated) && rep?.outputAck !== outputAckKey(rep, facts),
    };
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
    englishTemplates,
    setEnglishTemplates,
    templateNotice,
    templateManagerOpen,
    setTemplateManagerOpen,
    templatePrefsRef,
    templateListFailed,
    englishTemplatesRef,
    findTemplate,
    englishJjStatusOf,
    englishJjPickOf,
    englishJjSnapshotOf,
    englishPreviewDraft,
    englishRowFlags,
    englishTemplateNotReady,
    confirmEnglishOutput,
    outdatedEnglishRows,
    freshEnglishDraft,
    generateEnglishDraftFor,
    refillEnglishInner,
    copyEnglishText,
  };
}
