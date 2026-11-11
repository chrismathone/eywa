/**
 * 영어 행의 사실·인재원 상태·경고 판정 — 순수 함수(수정 계획 P3-O batch C, `use-english-template-mode.ts`에서 옮김 · 본문 그대로).
 * 화면 훅은 같은 이름의 얇은 함수로 이 함수들을 부른다(렌더 값 · 비동기 경로의 ref 값을 넘기는 것은 훅 몫).
 */
import { buildReportFields } from "./report-fields";
import { isJjSheetReport } from "./jj-books";
import type { OneScreenStudent, Subject } from "./types";
import type { SubjectReport } from "./components/report-card";
import { DEFAULT_ENGLISH_TEMPLATE, type ReportTemplate } from "@/features/report-templates/defaults";
import { attendanceSentence } from "./attendance-sentence";
import { rowMakeupFacts } from "./report-comment";
import { jjDayKey, jjDaySummary, jjKnownSlots, type JjDayCache } from "./jj-day";
import type { EnglishJjStatus } from "./components/english-template-panel";
import type { JjExamPickState } from "./components/english-jj-exam-picker";
import {
  isAiStale,
  isNameMissing,
  isTemplateStale,
  isTextOutdated,
  needsAiFirst,
  outputAckKey,
  pendingNeedsAi,
  slotFactsFor,
  type EnglishRowFacts,
} from "./english-draft";
import { resolveRowFields } from "./row-fields";
import type { useEnglishJj } from "./components/use-english-jj";

/** 영어 글 사실 줄 재료 — 담당자 이름 · 테스트 사용 여부 · 보는 날짜(인재원 하루치 열쇠). */
export type EnglishFactsCtx = { teacherName: string; showDailyTest: boolean; showCheckTest: boolean; activeDate: string };
/** 인재원 하루치 캐시와 받는 중 표시(use-english-jj.ts). */
export type JjView = Pick<ReturnType<typeof useEnglishJj>, "cache" | "pending">;

/**
 * 영어 행의 사실 — 표시 필드는 저장(buildReportFields)과 **같은 함수**로 만들고(오늘 과제 쪽수 후보정·테스트 표기)
 * 평가값은 행 단위(row-fields.ts)로 읽는다. 템플릿 글과 AI 지문이 모두 이 값에서 나온다.
 */
export function englishRowFactsOf(
  student: OneScreenStudent,
  su: Subject,
  // 그림 칸 판정의 기준 글(자동 글 → 지금 글) — 인재원 자료를 아직 모를 때 중립으로 두는 데 쓴다(slotFactsFor).
  rep: SubjectReport | undefined,
  // 렌더는 state, 비동기 경로(저장 직전 재조립·자동작성)는 ref를 넘긴다(use-english-jj.ts).
  jjCache: JjDayCache,
  ctx: EnglishFactsCtx,
): EnglishRowFacts {
  const { teacherName, showDailyTest, showCheckTest, activeDate } = ctx;
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
export function englishJjStatus(jj: JjView, studentId: string, activeDate: string): EnglishJjStatus {
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
export function englishJjPick(jj: JjView, studentId: string, activeDate: string): JjExamPickState | null {
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
export function englishJjSnapshot(jj: JjView, studentId: string, activeDate: string) {
  const st = jj.cache[jjDayKey(studentId, activeDate)];
  return st?.status === "ok" ? st.snapshot : null;
}

/** 경고 셋(칸 달라짐·AI 코멘트가 옛 값 기준·이름 없음) — 카드 칸·표 행·발송 확인이 같은 판정을 쓴다. */
export function englishRowFlagsOf(
  student: OneScreenStudent,
  su: Subject,
  rep: SubjectReport | undefined,
  deps: {
    findTemplate: (templateId: string | undefined) => ReportTemplate | null;
    englishFactsOf: (student: OneScreenStudent, su: Subject, rep?: SubjectReport) => EnglishRowFacts;
    /** 목록을 한 번이라도 받았나 · 못 받았나 — 받기 전엔 템플릿이 "지워졌다"고 단정하지 않는다. */
    templatesLoaded: boolean;
    templateListFailed: boolean;
  },
) {
  const { findTemplate, englishFactsOf, templatesLoaded, templateListFailed } = deps;
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
