/**
 * 보강 추가 흐름의 순수 판정 — 수정 계획 P3-O batch C, `use-makeup-flow.ts`에서 옮김(본문 그대로).
 * 확인창 상태 모양(`MakeupAsk`)·빈 결석 후보·보조 앵커·더할 보강 행·창에 보일 수업 후보.
 */
import type { OneScreenStudent, Subject } from "./types";
import type { TodayClass } from "./server/roster";
import { hostChoicesFor, type MakeupHostClass } from "@/features/attendance/makeup-host";
import type { MakeupAbsenceList } from "@/features/attendance/makeup-options";
import type { MergeCandidate } from "./makeup-merge-plan";

/**
 * 보강 추가 시 "정규 보고서에 합칠까 / 따로 낼까" 확인 대기(null=다이얼로그 닫힘).
 * 🔴 합침은 **여기서 확인해야만** 일어난다 — 자동 합치기는 강사가 결과를 예측 못 해 혼란을 낳았다(08-06).
 * `mk`는 '추가'를 누른 시점의 조립 결과(반 필터 앵커 포함)라 그대로 들고 있다가 '분리'에 쓴다.
 */
export type MakeupAsk = {
  studentId: string;
  studentName: string;
  mk: OneScreenStudent;
  candidates: MergeCandidate[];
  sentSubjects: string[];
  /** 목록에 없던 학생(그날 내 정규 수업 없음) — 확인 후에 카드를 만든다. */
  isNew: boolean;
  /** 그 학생의 결석 후보 한 벌(이전 반 포함) — 이월 보강 선택지 + 과목이 달라 뺀 건수. */
  absences: MakeupAbsenceList;
  /** 아직 불러오는 중 — 도착 전에 "결석 기록이 없습니다"라고 단언하지 않게. */
  absencesLoading: boolean;
  /**
   * 보강을 기록할 수업 후보(원장 2026-09-21 *"보강 추가시에 '수업'을 선택할 수 있어야겠어"* → 같은 날 *"항상 다른 수업을
   * 고를 수 있게"*) — 원스크린의 모든 보강 추가가 싣는다(합칠 정규 수업이 있어도). 없으면 창이 묻지 않는다(종전 앵커 그대로).
   */
  hostClasses?: { options: MakeupHostClass[]; loading: boolean; failed?: boolean; noneBlocked?: boolean };
};

/** 아직 안 불러왔을 때의 빈 결석 후보 한 벌 — 확인창은 이걸 받아 '직접 입력'만 보여 준다. */
export const EMPTY_ABSENCES: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

/**
 * 반 필터가 '전체'라 앵커가 없을 때의 **보조 앵커** — 합칠 정규 행(후보)의 반을 기준으로 삼는다.
 *
 * 🔴 이 경로가 비어 있으면 안 되는 이유: 후보를 고른 보강은 앵커가 없어도 결석분을 **실제로 쓴다**
 *    (`linkMakeupAbsence`가 `choice.absentClassId`로 그 칸에 메모를 붙인다). 즉 '전체'로 두고 합침/분리를
 *    고르면 수학 보강이 영어 결석 칸에 메모를 남길 수 있었다 — 고치려던 바로 그 사고다.
 * ⚠️ **후보가 한 과목일 때만** 쓴다(겸직 강사는 후보가 두 과목일 수 있고, 그때 첫 후보로 좁히면 다른 과목
 *    결석이 통째로 사라진다). 모르면 안 거른다 — 이 파일의 다른 폴백과 같은 비대칭.
 */
export function candidateAnchorClassId(candidates: readonly MergeCandidate[]): string | null {
  const keys = new Set(candidates.map((c) => c.subjectKey).filter(Boolean));
  return keys.size === 1 ? (candidates[0]?.classId ?? null) : null;
}

/** 화면의 출결 함수 — 보강 합침·추가가 그 반 칸을 고친다(알약과 같은 함수). */

/**
 * 이 카드에 **더할 보강 행**(이름 붙이기 전) — `addSeparateMakeupRows`와 창을 열기/등록하기 전 멈춤이 같은 판정을 쓴다.
 * 비어 있으면 같은 과목 보강 행이 이미 있다는 뜻이다.
 */
export function pendingMakeupRows(existing: OneScreenStudent, mk: OneScreenStudent, onlySubjectKey?: string): Subject[] {
  // mk.subjects는 강사의 **모든 담당 과목**이라, 그대로 병합하면 math만 듣는 학생 카드에 '영어 (보강)' 잡행까지
  // 붙는다(2026-07-24 적대검수). 학생이 실제 수강하는 과목(정규+특강 행)으로 좁히되, 겹치는 과목이 하나도 없으면
  // (학생이 안 듣는 과목의 순수 추가보강) 종전대로 전체를 후보로 둔다.
  const attended = new Set(existing.subjects.filter((su) => !su.makeup).map((su) => su.subjectKey));
  const attendedRows = mk.subjects.filter((su) => attended.has(su.subjectKey));
  const source = onlySubjectKey
    ? mk.subjects.filter((su) => su.subjectKey === onlySubjectKey)
    : attendedRows.length
      ? attendedRows
      : mk.subjects;
  // 같은 과목 보강 행이 이미 있으면 중복 추가 안 함.
  return source.filter((su) => !existing.subjects.some((ex) => ex.makeup && !ex.classId && ex.subjectKey === su.subjectKey));
}

/**
 * 창에 보일 수업 후보 — 🔴 **그 학생이 다니는 반만**(원장 2026-09-21 *"해당 학생의 소속 수업만 띄워"*) · 그 학생이 **오늘 이 화면에
 * 정규 행이 있는 반은 뺀다**: 그 반은 정규 칸이 이미 있어 저장 훅이 보강 칸을 따로 세우지 않는다(합칠 수 없는 결석 등) — 보이면
 * "그 반에 기록합니다"가 지킬 수 없는 약속이 된다. 판정은 [`hostChoicesFor`] 한 곳(확인창도 같은 함수 · 기본값도 이 목록으로 본다).
 */
export function hostChoicesOfAsk(ask: MakeupAsk, students: readonly OneScreenStudent[], todayClasses: readonly TodayClass[]) {
  if (!ask.hostClasses) return undefined;
  const rows = students.find((s) => s.id === ask.studentId)?.subjects.filter((su) => !su.makeup && su.classId) ?? [];
  const regular = rows.map((su) => su.classId!);
  // 담임 반에 정규 칸이 있으면(합칠 수 없는 칸 포함) 확인창이 '반 없이'를 세우지 않는다 — 보고서 저장 훅이 보강 반을 안 만들어 시수가 아무 데도
  // 안 선다. 🔴 훅과 같은 **담임** 축이다: 위임받은 반의 칸은 훅이 못 본다(그 반 담임은 원래 담임이라 보강 반이 선다 — 막으면 되던 보강이 막힌다,
  // 재리뷰 2026-09-21). 오늘 반 목록에 없는 반은 담임 반으로 친다(모르면 막는 쪽 — 시수가 사라지는 것보다 낫다).
  const ownRegular = rows.some((su) => !todayClasses.find((c) => c.id === su.classId)?.delegated);
  return { ...ask.hostClasses, options: hostChoicesFor(ask.hostClasses.options, regular), regularToday: ownRegular };
  // ⚠️ `noneBlocked`(반별 발송 대상 — '반 없이' 금지)는 `ask.hostClasses`에 실려 그대로 넘어간다.
}
