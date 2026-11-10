"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { markAutowrite } from "../write-timing-store";
import { buildSubjectReport } from "../report";
import { buildReportCommentInput } from "../report-comment";
import { buildExamInfo as buildExamInfoOf } from "../report-fields";
import { generateReportComment } from "../server/actions";
import {
  activeUnderstanding,
  isMathReportPilot,
  isPilotAutoWritten,
  pilotCanEdit,
  PILOT_SECTION_TITLES,
} from "../math-report-pilot";
import { pilotRowSig } from "../math-report-pilot-sections";
import { mergePilotDraft, pilotSectionBody } from "../pilot-merge";
import { pilotSendBlocks } from "../pilot-send-gate";
import { resolveRowFields } from "../row-fields";
import { detectClassNotices } from "../class-notice";
import { hasTextBesidesAttachments } from "@/features/report-templates/attachment-lines";
import type { EnglishGenStatus } from "../english-draft";
import type { GridRow, RowAction } from "../grid";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * AI 자동작성(카드 과목 버튼 · 표 행 · 표 일괄) — 수정 계획 P3-O 5/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 로딩 표시 셋은 **따로** 둔다: `genSubject`(카드 과목 버튼) · `genKey`(표 행) · `bulkGen`(표 일괄). 하나로 합치면 어느 버튼이
 * 도는지가 바뀐다(계획 — 통일은 별도 변경). 영어 '다시 채우기' 연타 막기(refillBusyRef)·받는 중 고른 템플릿(refillNextRef)도 여기.
 * 영어 템플릿 글 만들기·채우기 본문(generateEnglishDraftFor·refillEnglishInner)은 화면에 남아 `english`로 넘어온다.
 */
export function useAutoWrite({
  ctx: { selected, readonlyView, date, activeDate, showDailyTest, showCheckTest, classNarratives },
  refs: { reportsRef, studentsRef },
  i18n: { t, tf },
  bulkBusy,
  rows: { selectRows, latestRow, latestStudent },
  actions: { readonlyBlocked, patchReport },
  english: { generateEnglishDraftFor, refillEnglishInner },
}: {
  ctx: {
    selected: OneScreenStudent | null;
    readonlyView: boolean;
    /** 조회 대상 날짜 원문(빈값 = 서버 오늘) — 서버 호출에 그대로 싣는다. */
    date: string;
    /** 화면 날짜(빈값이면 오늘로 푼 값) — 작성 시간 기록·멘트 재료. */
    activeDate: string;
    showDailyTest: boolean;
    showCheckTest: boolean;
    /** 반 공통 서술(G6) — 반 id → 서술. */
    classNarratives: Record<string, string>;
  };
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  /** 일괄 저장·발송 진행 중 — 일괄 자동작성의 재진입 잠금(#10). */
  bulkBusy: "save" | "send" | null;
  rows: {
    selectRows: (action: RowAction, keys?: string[]) => GridRow[];
    latestRow: (studentId: string, subjectName: string) => OneScreenStudent | null;
    latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
  };
  actions: {
    readonlyBlocked: () => boolean;
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
  };
  english: {
    generateEnglishDraftFor: (student: OneScreenStudent, su: Subject, quiet?: boolean) => Promise<EnglishGenStatus>;
    refillEnglishInner: (student: OneScreenStudent, subjectName: string, templateId?: string) => Promise<void>;
  };
}) {
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(카드 버튼 로딩)
  const [genKey, setGenKey] = useState<string | null>(null); // 표 행별 자동작성 로딩 키(studentId::과목)
  // 다시 채우기가 인재원 자료를 기다리는 동안 또 누르면 '덮을까요?' 확인이 겹쳐 뜬다 — 진행 중인 (학생,과목)을 막는다.
  const refillBusyRef = useRef(new Set<string>());
  // 받는 중에 고른 **다른** 템플릿 — 끝난 뒤 그걸로 한 번 더 채운다(마지막 선택이 이긴다, 적대 재리뷰).
  const refillNextRef = useRef(new Map<string, string>());
  const [bulkGen, setBulkGen] = useState(false); // 표 일괄 자동작성 진행중
  /**
   * 템플릿으로 다시 채우기 — 지금 칸 값 + 마지막 AI 인사말·코멘트로 글을 다시 만든다(AI 재호출 없음).
   * 🔴 강사가 손본 글이면 먼저 묻는다 — 말없이 덮으면 고친 문장이 사라진다.
   */
  async function refillEnglishFor(student: OneScreenStudent, subjectName: string, templateId?: string) {
    const busyKey = `${student.id}|${subjectName}`;
    if (refillBusyRef.current.has(busyKey)) {
      // 받는 중에 또 누름 — '다시 채우기' 연타는 버리고(확인 창이 겹쳐 뜬다), 다른 템플릿 고르기는 기억해 뒀다 끝난 뒤 채운다.
      if (templateId) refillNextRef.current.set(busyKey, templateId);
      return;
    }
    refillBusyRef.current.add(busyKey);
    try {
      await refillEnglishInner(student, subjectName, templateId);
    } finally {
      refillBusyRef.current.delete(busyKey);
    }
    const next = refillNextRef.current.get(busyKey);
    refillNextRef.current.delete(busyKey);
    if (next && next !== templateId) await refillEnglishFor(latestStudent(student, subjectName), subjectName, next);
  }
  // AI 학부모 멘트 + 학습 추세 생성 코어(카드·표 공용) — 멘트 실패 시 결정적 템플릿 폴백,
  // 추세는 표본 부족/실패면 조용히 생략(기존 값 유지). 둘을 학생별 병렬(Promise.all)로 생성해 지연 최소화.
  /** 자동작성 — 기다린 시간을 작성 시간 기록의 '자동작성' 영역에 적는다(선생님 손 시간과 따로). */
  async function generateDraftFor(
    student: OneScreenStudent,
    subjectName: string,
    opts?: { quiet?: boolean },
  ): Promise<EnglishGenStatus | undefined> {
    const startedAt = Date.now();
    try {
      return await generateDraftForInner(student, subjectName, opts);
    } finally {
      if (!readonlyView) markAutowrite(activeDate, student.id, subjectName, startedAt);
    }
  }
  async function generateDraftForInner(
    student: OneScreenStudent,
    subjectName: string,
    opts?: { quiet?: boolean },
  ): Promise<EnglishGenStatus | undefined> {
    if (readonlyView) return; // 조용히 — 상위 진입(autoWrite*)이 이미 토스트를 띄운다(일괄이면 N개가 쌓인다)
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    if (idx < 0) return;
    const su = student.subjects[idx];
    // 🔑 영어 행 = 템플릿 모드(2026-09-10) — 멘트·추세 대신 템플릿 글을 만든다. 수학 경로는 아래 그대로다.
    if (su?.subjectKey === "english") return generateEnglishDraftFor(student, su, opts?.quiet ?? false);
    // ⚠️ 과목**키**(math…)여야 한다 — su.name엔 반 이름이 붙을 수 있어 폴백도 subjectLabel 먼저.
    const subjectKey = su?.subjectKey || su?.subjectLabel || su?.name || undefined;
    // 반 공통 서술(G6) — 이 행의 반 서술을 생성 재료로 동봉(없으면 기존 동작). 카드·표·일괄 공용 경로라 전부 커버.
    // ⚠️ 키 = classId(이름 아님) — 동명 반(수학·영어 같은 이름, 스키마 허용)에서 이름 키면 남의 반 수업
    // 맥락이 교차 주입된다(리뷰 확정 major, 순서 기능 동명 가드와 같은 원인). classId null(모호 행·보강)=서술 없음.
    const classContext = (su?.classId && classNarratives[su.classId]) || "";
    // 이 행의 평가값 — 멘트(buildReportCommentInput)와 **같은 층**을 추세 재료로도 쓴다.
    const rowEval = resolveRowFields(student, su);
    // 🔴 특이사항 칸에 들어온 **반 공지**를 개인 관찰과 갈라 준다(class-notice.ts) — 같은 반 학생들의
    //    특이사항이 전부 똑같으면 그건 개인 관찰일 수 없다. 안 가르면 모델이 6명분 관찰을 지어내
    //    멘트가 서로 복사본처럼 된다(2026-08-13 실측: 한 반 6명 특이사항이 글자까지 동일).
    //    ⚠️ 판정 대상은 **화면에 있는 지금 로스터 전체**다 — 강사가 보고 있는 반들이 곧 판정 모집단이다.
    const classNotices = detectClassNotices(
      studentsRef.current.flatMap((st) =>
        st.subjects.map((row) => ({ classId: row.classId, note: resolveRowFields(st, row).note })),
      ),
    );
    // 수학 보고서 시범(테스트 학생 한정) — 이해도를 싣고, 특이사항은 반 공지로 가르지 않는다(맨 아래에 그대로 붙는다).
    const pilot = isMathReportPilot(student.id, su?.subjectKey);
    const baseInput = buildReportCommentInput(student, idx, pilot ? undefined : classNotices, activeDate);
    const commentInput = pilot
      ? {
          ...baseInput,
          understanding: activeUnderstanding(su?.today, su?.understanding),
          // 일일 테스트 '없음'이면 점수 대신 사유가 나간다(math-report-pilot-sections.ts).
          ...(su?.dailyTestSkip ? { dailyTestSkip: su.dailyTestSkip, dailyTest: "" } : {}),
          homeworkMissReason: su?.homeworkMissReason ?? "",
          attitudeNote: su?.attitudeNote ?? "",
          lessonMemo: su?.lessonMemo ?? "",
        }
      : baseInput;
    // 이번 글을 만든 값의 서명 — 발송 게이트(카드·표)가 같은 함수로 지금 값과 대조한다.
    const writtenFactsSig = pilot ? pilotRowSig(student, subjectName) : undefined;
    // 새 수학 보고서에서 선생님이 **고친 글** — 다시 쓰면 고친 말이 다 사라진다(원장 2026-10-27 *"쓴게 다 없어 진데요"*).
    //  · 값이 바뀌어 발송이 막힌 글 = AI 없이 바뀐 사실 항목만 다시 맞춘다(pilot-merge.ts) — 고친 '오늘의 수업'·손댄 항목은 그대로.
    //  · 막히지 않은 글에서 누르면 = 정말 새로 쓸지 묻는다(일괄은 고친 글을 건드리지 않는다).
    const curRep = reportsRef.current[student.id]?.[subjectName];
    const editedPilot =
      pilot && pilotCanEdit(curRep?.autoDraft) && !!(curRep?.draft ?? "").trim() && !isPilotAutoWritten(curRep?.draft, curRep?.autoDraft);
    if (editedPilot) {
      const stale = pilotSendBlocks(student, subjectName, curRep).includes("autowrite");
      if (!stale) {
        if (opts?.quiet || !window.confirm(t("os.c.pilotRewriteConfirm"))) return;
      } else {
        try {
          const res = await generateReportComment({ ...commentInput, classContext }, {
            studentId: student.id,
            subject: subjectKey,
            classId: su?.classId ?? null,
            date: date || undefined,
          }, { pilotKeepUnderstanding: pilotSectionBody(curRep?.draft, PILOT_SECTION_TITLES.understanding) });
          if (!(res.ok && res.comment)) {
            toast.error(t("os.c.pilotGenFailed"));
            return;
          }
          const fresh = res.comment;
          patchReport(student.id, subjectName, (r) => {
            const merged = mergePilotDraft(r.draft, r.autoDraft, fresh);
            return { ...r, draft: merged.draft, autoDraft: merged.autoDraft, pilotFactsSig: writtenFactsSig };
          });
          if (!opts?.quiet) toast.success(t("os.c.pilotMerged"));
        } catch {
          toast.error(t("os.c.pilotGenFailed"));
        }
        return;
      }
    }
    try {
      // 통합 1회 호출 — 멘트 + 추세를 한 번에 생성(비용·지연↓).
      const res = await generateReportComment({ ...commentInput, classContext }, {
        studentId: student.id,
        subject: subjectKey,
        classId: su?.classId ?? null, // 정규/특강 추세 분리(2026-07-23) — 이 행의 반.

        // 🔴 추세가 **숫자를 말하는** 자리다 — 재료는 멘트와 같은 행 값(row-fields.ts)이어야 한다.
        //    2026-08-13에 점수·과제 수행률이 행 단위로 갈렸는데 이 두 줄만 학생 값으로 남아, 강사가 그 행에서
        //    점수를 고쳐도 추세엔 **다른 행(정규)의 점수**가 실렸다(보강·특강 행일수록 어긋난다).
        todayExamInfo: buildExamInfoOf(rowEval.tests, showDailyTest, showCheckTest),
        todayHomework: rowEval.homework,
        date: date || undefined, // 보는 날짜 — 과거 날짜면 추세를 그 날짜 기준으로(이후 채점 이력 있으면 추세 생략)
      });
      // 시범 대상은 기본 문구로 대신 채우지 않는다 — 진도·이해도·특이사항 구조가 없는 글이 '자동작성'으로 잡혀 발송 게이트를 지난다.
      if (pilot && !(res.ok && res.comment)) {
        toast.error(t("os.c.pilotGenFailed"));
        return;
      }
      const text = res.ok && res.comment ? res.comment : buildSubjectReport(student, idx);
      if (!res.ok) toast.message(t("os.c.aiFallback"));
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        draft: text,
        // 작성 방식 스냅샷(0214a) — AI 성공분·템플릿 폴백 모두 "자동이 넣은 텍스트". 저장 시 draft와 비교.
        autoDraft: text,
        // 수학 보고서 시범 — 이번 글을 만든 이해도 서명(점수가 글에 숫자로 없어 발송 게이트가 이걸로 대조한다).
        ...(pilot ? { pilotFactsSig: writtenFactsSig } : {}),
        // 폴백 템플릿이면 표시 — 자동작성 원문(0370a)으로 싣지 않는다.
        autoDraftTemplate: !(res.ok && res.comment),
        // 추세는 생성 성공 시에만 갱신(표본 부족·실패면 기존 초안·수동 입력 보존). 만들었지만 검사에 걸려 버렸으면 비운다
        // (예전 초안이 그대로 나가지 않게 — 2026-10-15). 달라진 게 없으면(trendQuiet) 칸이 지난 자동작성 글 그대로일 때만 비운다
        // — 선생님이 손으로 쓰거나 고친 추세는 지킨다(적대적 재리뷰 2026-10-16).
        ...(res.ok && res.trend
          ? { trendDraft: res.trend, trendAutoDraft: res.trend }
          : res.ok && res.trendDropped
            ? { trendDraft: "", trendAutoDraft: "" }
            : res.ok && res.trendQuiet && (r.trendDraft ?? "") === (r.trendAutoDraft ?? "")
              ? { trendDraft: "", trendAutoDraft: "" }
              : {}),
      }));
    } catch {
      if (pilot) {
        toast.error(t("os.c.pilotGenFailed"));
        return;
      }
      const fallback = buildSubjectReport(student, idx);
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: fallback, autoDraft: fallback, autoDraftTemplate: true }));
      toast.message(t("os.c.aiFallback"));
    }
  }
  async function autoWriteSubject(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const student = selected; // 클로저 고정 — 생성 중 학생 전환돼도 원래 학생에 반영
    setGenSubject(subjectName);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenSubject((cur) => (cur === subjectName ? null : cur));
    }
  }
  // 표: 행별 자동작성(genKey로 그 행만 로딩) + 일괄 자동작성(순차). 생성된 draft는 일괄 발송이 그대로 사용.
  async function autoWriteRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const key = `${student.id}::${subjectName}`;
    setGenKey(key);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenKey((cur) => (cur === key ? null : cur));
    }
  }
  async function autoWriteAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) return; // 재진입·중첩 방지
    const eligible = selectRows("autowrite", keys);
    const skipped = keys?.length ? keys.length - eligible.length : 0; // 선택했지만 진도 없어 제외된 행(미선택=전체=0, 음수 방지 #11)
    // ⚠️ 이미 멘트가 있는 행은 **건너뛴다** — 손으로 다듬은 문구를 일괄 재생성이 확인 없이 덮어쓰던 문제(#12 확정).
    //    개별 '자동작성' 버튼(autoWriteRow)은 그 행만 명시 재생성하므로 재생성 의도는 그쪽으로.
    // 사진·PDF 줄만 있는 행은 글이 없는 행이다(영어 — 그 줄은 새 글에 따라온다). 수학 글엔 첨부 줄이 없어 결과가 같다.
    const hasDraft = (r: (typeof eligible)[number]) =>
      hasTextBesidesAttachments(reportsRef.current[r.student.id]?.[r.subject.name]?.draft);
    // 예외 — 새 수학 보고서의 **손대지 않은 자동작성 글**인데 그 뒤 값(출결·점수·태도…)이 바뀐 행은 다시 쓴다(원장 2026-10-26).
    //   그 글은 사람이 다듬은 글이 아니라 옛 값으로 쓴 기계 글이고, 다시 안 쓰면 행마다 눌러야 발송이 풀린다. 고친 글은 그대로 건너뛴다.
    const staleAuto = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    // 선생님이 고친 글인데 값이 바뀌어 막힌 행 — AI 없이 바뀐 항목만 맞춘다(고친 말은 그대로, generateDraftFor의 합치기). 원장 2026-10-27.
    const staleEdited = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        pilotCanEdit(rep?.autoDraft) &&
        !isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    const rows = eligible.filter((r) => !hasDraft(r) || staleAuto(r) || staleEdited(r));
    const preserved = eligible.length - rows.length;
    if (rows.length === 0) {
      toast.message(
        preserved
          ? tf("os.c.genNonePreserved", { n: preserved })
          : t("os.c.genNone"),
      );
      return;
    }
    setBulkGen(true);
    // 영어 행 결과는 모아서 한 번에 알린다(행마다 토스트를 띄우면 30개가 쌓인다) — 글을 안 바꾼 행은 '완료'에서 뺀다.
    let englishSkipped = 0;
    let templateFallback = false;
    try {
      for (const r of rows) {
        setGenKey(`${r.student.id}::${r.subject.name}`);
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const status = await generateDraftFor(student, r.subject.name, { quiet: true });
        if (status === "loading" || status === "ai_failed" || status === "edited") englishSkipped++;
        else if (status === "template_fallback") templateFallback = true;
      }
    } finally {
      setGenKey(null);
      setBulkGen(false);
    }
    toast.success(
      tf("os.c.genDone", { n: rows.length - englishSkipped }) +
        (preserved ? tf("os.c.genPreserved", { n: preserved }) : "") +
        (skipped ? tf("os.c.genSkipped", { n: skipped }) : ""),
    );
    if (englishSkipped) toast.message(tf("os.tpl.bulkSkipped", { n: englishSkipped }));
    if (templateFallback) toast.message(t("os.tpl.templateMissing"));
  }
  return { genSubject, genKey, bulkGen, refillEnglishFor, autoWriteSubject, autoWriteRow, autoWriteAllVisible };
}
