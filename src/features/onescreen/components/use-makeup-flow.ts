"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { registerMakeupEntries } from "../server/makeup-register-actions";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import { setMakeupClass } from "../server/makeup-class-actions";
import { buildMakeupStudent } from "../server/actions";
import type { TemplatePrefs } from "../last-template";
import { removeMakeupEntry } from "../server/makeup-remove-actions";
import { makeupRemoveBlockReason } from "../makeup-remove-plan";
import { makeupRowName } from "../makeup-label";
import type { OneScreenStudent, Subject } from "../types";
import { CLASS_TAG_ALL } from "../class-tags";
import type { TodayClass } from "../server/roster";
import { effectiveClassnoteStatus, isAlreadySent } from "../grid";
import { linkMakeupToAbsence } from "@/features/attendance/server/actions";
import type { MakeupConfirmChoice } from "@/features/attendance/components/makeup-confirm-dialog";
import { fetchMakeupAbsences, fetchMakeupHostClasses } from "@/features/attendance/server/makeup-actions";
import { hostChoicesFor, type MakeupHostClass } from "@/features/attendance/makeup-host";
import { noteMakeupAgainstAbsence } from "@/features/attendance/server/makeup-note-action";
import type { MakeupAbsenceList } from "@/features/attendance/makeup-options";
import { mergeStatusOf, planMakeupMerge, type MergeCandidate } from "../makeup-merge-plan";
import { initReports, type ReportsState } from "../session-input";
import { shortDate } from "../makeup-absence-link";
import type { SendClassAsk } from "./send-class-dialog";
import type { AttendanceSelection } from "./attendance-pills";
import type { useSessionAutosave } from "./use-session-autosave";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 아직 안 불러왔을 때의 빈 결석 후보 한 벌 — 확인창은 이걸 받아 '직접 입력'만 보여 준다. */
const EMPTY_ABSENCES: MakeupAbsenceList = { options: [], hiddenBySubject: 0 };

/**
 * 반 필터가 '전체'라 앵커가 없을 때의 **보조 앵커** — 합칠 정규 행(후보)의 반을 기준으로 삼는다.
 *
 * 🔴 이 경로가 비어 있으면 안 되는 이유: 후보를 고른 보강은 앵커가 없어도 결석분을 **실제로 쓴다**
 *    (`linkMakeupAbsence`가 `choice.absentClassId`로 그 칸에 메모를 붙인다). 즉 '전체'로 두고 합침/분리를
 *    고르면 수학 보강이 영어 결석 칸에 메모를 남길 수 있었다 — 고치려던 바로 그 사고다.
 * ⚠️ **후보가 한 과목일 때만** 쓴다(겸직 강사는 후보가 두 과목일 수 있고, 그때 첫 후보로 좁히면 다른 과목
 *    결석이 통째로 사라진다). 모르면 안 거른다 — 이 파일의 다른 폴백과 같은 비대칭.
 */
function candidateAnchorClassId(candidates: readonly MergeCandidate[]): string | null {
  const keys = new Set(candidates.map((c) => c.subjectKey).filter(Boolean));
  return keys.size === 1 ? (candidates[0]?.classId ?? null) : null;
}

/** 화면의 출결 함수 — 보강 합침·추가가 그 반 칸을 고친다(알약과 같은 함수). */
export type MakeupAttendanceDeps = {
  setAttendanceFor: (
    studentId: string,
    classId: string,
    status: AttendanceSelection | "early_leave",
    extra?: { note?: string | null; units?: string },
    opts?: { overwrite?: boolean },
  ) => Promise<unknown>;
  applyAttendanceLocal: (
    studentId: string,
    classId: string,
    raw: string | null,
    extra?: { note?: string | null; units?: number | null },
  ) => void;
  withMark: (s: OneScreenStudent) => OneScreenStudent;
};

/**
 * 보강 추가 흐름 — 수정 계획 P3-O 8/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 학생 고르기 → 합침/분리·수업·결석분을 묻는 확인창(`makeupAsk`) → 확인(`resolveMakeupAsk`)이 등록·합침·분리·결석 메모를 한다.
 * 보강 행의 수업 바꾸기(`pickMakeupClass`)·빼기(`removeMakeupRow`)도 여기. 저장 중(`makeupSaving`)엔 날짜 이동·다른 보강 동작을 막는다.
 * 🔴 결석·수업 후보 조회는 응답 순서 가드(`absenceSeq`·`hostSeq`)로 늦게 온 옛 응답이 새 창을 덮지 않게 한다.
 * 보강 학생 이전 진도 불러오기는 use-makeup-prev.ts.
 */
export function useMakeupFlow({
  ctx: { date, activeDate, classFilter, matchingClasses, todayClasses },
  state: { students, setStudents, reports, setReports, studentsRef, templatePrefsRef },
  i18n: { t, tf },
  ui: { setSelId, setCardSubject, askSendClass },
  rows: { patch, readonlyBlocked, applySessionSaveResult },
  attendance: { setAttendanceFor, applyAttendanceLocal, withMark },
}: {
  ctx: {
    /** 조회 대상 날짜 원문(빈값 = 서버 오늘). */
    date: string;
    activeDate: string;
    classFilter: string;
    matchingClasses: TodayClass[];
    todayClasses: TodayClass[];
  };
  state: {
    students: OneScreenStudent[];
    setStudents: Dispatch<SetStateAction<OneScreenStudent[]>>;
    reports: ReportsState;
    setReports: Dispatch<SetStateAction<ReportsState>>;
    studentsRef: { readonly current: OneScreenStudent[] };
    templatePrefsRef: { readonly current: TemplatePrefs };
  };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  ui: {
    setSelId: Dispatch<SetStateAction<string>>;
    setCardSubject: Dispatch<SetStateAction<{ id: string; idx: number }>>;
    askSendClass: (ask: Omit<SendClassAsk, "resolve">) => Promise<string | null>;
  };
  rows: {
    patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
    readonlyBlocked: () => boolean;
    applySessionSaveResult: ReturnType<typeof useSessionAutosave>["applySessionSaveResult"];
  };
  attendance: MakeupAttendanceDeps;
}) {
  /**
   * 보강 추가 시 "정규 보고서에 합칠까 / 따로 낼까" 확인 대기(null=다이얼로그 닫힘).
   * 🔴 합침은 **여기서 확인해야만** 일어난다 — 자동 합치기는 강사가 결과를 예측 못 해 혼란을 낳았다(08-06).
   * `mk`는 '추가'를 누른 시점의 조립 결과(반 필터 앵커 포함)라 그대로 들고 있다가 '분리'에 쓴다.
   */
  const [makeupSaving, setMakeupSaving] = useState(false);
  const [makeupAsk, setMakeupAsk] = useState<{
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
  } | null>(null);
  /**
   * 결석 조회 응답 순서 가드(옆 두 화면 `input-form`·`makeup-add-flow`와 같은 규약).
   * 🔴 **학생 id만으로는 부족하다** — 같은 학생을 반 필터를 바꿔 두 번 열면 조회 결과가 **앵커마다 다르므로**,
   *    늦게 온 옛 조회가 새 창을 덮으면 **다른 과목 목록 + 그 과목 라벨**이 뜬다(과목 필터 이전엔 두 응답이
   *    같아서 안 보이던 레이스다).
   */
  const absenceSeq = useRef(0);
  /** 수업 후보 조회 응답 순서 가드 — 결석 조회와 같은 규약(늦게 온 옛 응답이 새 창을 덮지 않게). */
  const hostSeq = useRef(0);
  /**
   * 🔴 보강 칸은 **서버가 앵커 반에** 적는다(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 확인하는 순간 등록 문(`registerMakeupEntries`,
   *    `recordCell`)이, 보고서를 저장할 때 저장 훅(`saveLessonReport`)이 **같은 함수**(`syncAnchorCells`)로 기다려서 적는다(이미 있으면 그대로).
   *    예전엔 확인창이 여기서 칸을 **기다리지 않고** 먼저 적었고(`persistAnchorMakeup`), 실패하면 저장 훅이 다른 반(예약 반·보강 반)에
   *    칸을 세워 보고서 반과 출석부 반이 갈렸다(C2). 확인 때 적어 두는 이유 = 보고서를 안 쓰는 보강(영어 등)·저장 실패에도 시수가 남게.
   */
  // 보강(수업외) 학생 추가 — 서버에서 OneScreenStudent 조립(담당 과목·교재 기본값).
  //
  // ⚠️ 정규/특강으로 **이미 목록에 있는 학생**도 보강 추가가 돼야 한다(2026-07-24 원장: 특강+정규외 보강).
  //    별도 카드(가짜 id)는 카드 id가 곳곳에서 DB 학생 id로 쓰여 첨부·발송상태를 깨뜨린다(적대검수 실측) →
  //    대신 **그 학생 카드에 '수학 (보강)' 행을 병합**한다(카드 id=실제 학생 id 불변 = 안전). 보강 행은
  //    classId=null·makeup=true라 DB에서 정규 보고서와 별개(unit_key 분리)로 저장되고, 학부모 보고서엔 "(보강)"이 붙는다.
  async function addMakeupStudent(studentId: string) {
    if (readonlyBlocked()) return;
    const res = await buildMakeupStudent(studentId, date || undefined); // 조회 중인 날짜 전달(과거 백필 중복게시 방지)
    if (!res.ok || !res.student) {
      toast.error(res.error ?? t("os.c.addStudentFail"));
      return;
    }
    // 보강을 **어느 수업 시간에** 하는지 = 지금 보고 있는 반 필터. 이게 반 필터 앵커가 된다(0171a) —
    // 앵커가 없으면(전체에서 추가·동명 반이라 특정 불가) 그 보강 행은 '전체'에서만 보인다.
    // 🔴 예전엔 앵커가 없어 보강 학생이 **모든 반 필터**에 나왔다(원장 제보 2026-08-03).
    // ⚠️ 이름은 **필터가 걸려 있으면 항상** 남긴다(id는 동명 반이면 특정 불가 → null). id가 없다고 이름까지
    //    비우면, 동명 반을 고른 채 보강을 추가했을 때 카드가 그 자리에서 사라진다 = 2026-07-27 그 버그 재발.
    const anchorName = classFilter === CLASS_TAG_ALL ? null : classFilter;
    const anchorId = matchingClasses.length === 1 ? matchingClasses[0]!.id : null;
    const withAnchor = (su: Subject): Subject => ({
      ...su,
      makeupClassId: anchorId,
      makeupClassName: anchorName,
    });
    // 🔴 과목 **키**로 거른다 — `TodayClass.subject`는 표시 라벨("수학")이라 키("math")와 비교하면 늘 거짓이고,
    //    반 칩을 고른 채 보강을 추가하면 보강 줄이 0개가 되어 저장이 "보강 날짜와 과목을 확인해 주세요"로 막혔다
    //    (원장 제보 2026-09-14 권영준·이수진). 키를 모르면("") 거르지 않는다(종전 '전체'와 같은 동작).
    const anchorSubject = matchingClasses.length === 1 ? matchingClasses[0]!.subjectKey || null : null;
    const mk = {
      ...res.student,
      subjects: res.student.subjects.filter(su => !anchorSubject || su.subjectKey === anchorSubject).map(withAnchor),
    };
    const existing = students.find((s) => s.id === studentId);
    if (!existing) {
      // 🔴 목록에 없던 학생도 **묻고 나서** 추가한다(원장 2026-08-19: *"이름 검색하고 누르면 그냥 추가되고
      //    끝이야"*). 예전엔 여기서 바로 카드를 만들어, 보강의 대다수인 "다른 반 학생"에서 결석분·시수를
      //    물을 자리가 아예 없었다. 카드는 확인 후 `resolveMakeupAsk`가 만든다(취소하면 아무 일도 없다).
      if (anchorName) {
        mk.tag = anchorName;
        mk.className = anchorName;
      }
      setMakeupAsk({
        studentId,
        studentName: mk.name,
        mk,
        candidates: [],
        sentSubjects: [],
        isNew: true,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        hostClasses: { options: [], loading: true },
      });
      void loadAbsences(studentId, anchorId);
      void loadHostClasses(studentId, mk.subjects);
      return;
    }
    // 🔴 **자동으로 합치지 않는다 — 묻는다**(원장 2026-08-06: *"선생님들이 헷갈린대"*).
    //    2026-08-05엔 정규 행이 있으면 말없이 합쳤는데(제목이 "(정규+보강)"이 되고 수업타임이 2가 된다),
    //    보강을 추가한 강사는 그 결과만 보게 돼 무슨 일이 일어난 건지 몰랐다.
    //    → `planMakeupMerge`가 후보를 고르고, 다이얼로그가 **합침 ↔ 분리 토글**로 물어본 뒤 고른 대로만 한다.
    //      · 합침 = 정규 행 1건에 합쳐 "(정규+보강)" 한 번만 발송(수업타임 +1)
    //      · 분리 = 종전(08-05 이전)대로 별도 "(보강)" 행 → 정규 1건 + 보강 1건, 2건 발송
    //    ⚠️ 후보를 고르는 3조건(내 과목·반 있는 정규 행·시수 올려도 되는 상태)은 그대로다 — 판정은
    //       [makeup-merge-plan.ts](../makeup-merge-plan.ts) 단일 소스(순수+Vitest).
    const teacherSubjectKeys = new Set(mk.subjects.map((su) => su.subjectKey).filter((k): k is string => !!k));
    const plan = planMakeupMerge(existing.subjects, teacherSubjectKeys);
    if (plan.kind === "already") {
      // 이미 합쳐 둔 과목이 있으면 **또 만들지 않는다** — 두 번 누르면 별도 "(보강)" 행이 생겨 보고서가
      // 결국 두 번 나간다. 예전 "이미 보강 행이 추가되어 있습니다"와 같은 규약.
      setSelId(existing.id);
      toast.message(
        tf("os.c.makeupAlready", { name: existing.name, subjects: plan.subjects.join("·") }),
      );
      return;
    }
    if (plan.kind === "ask") {
      // ⚠️ 이미 발송된 정규 보고서는 수정이 막혀 있다(발송본 잠금) — 합치면 보강 내용이 안 실린다는 사실을
      //    **고르기 전에** 다이얼로그에서 알린다(원장 2026-08-05 경고 요구를 선택 시점으로 앞당긴 것).
      const sentSubjects = plan.candidates
        .filter((c) =>
          isAlreadySent(
            effectiveClassnoteStatus(
              reports[studentId]?.[c.name]?.classnoteStatus,
              existing.subjects.find((su) => su.name === c.name)?.classnoteStatus,
            ),
          ),
        )
        .map((c) => c.name);
      setSelId(existing.id);
      setMakeupAsk({
        studentId,
        studentName: existing.name,
        mk,
        // 반 이름은 확인창 선택지 표시용(판정은 classId) — 행 이름("수학")만으론 어느 반인지 안 보인다.
        candidates: plan.candidates.map((c) => ({ ...c, className: todayClasses.find((x) => x.id === c.classId)?.name ?? null })),
        sentSubjects,
        isNew: false,
        absences: EMPTY_ABSENCES,
        absencesLoading: true,
        // 🔴 정규 수업이 있어도 **다른 수업을 고를 수 있다**(원장 2026-09-21 *"보강을 항상 다른 수업을 고를 수 있게 해야 따로 보강 행이
        //    안생겨서 수납 분리가 쉬울듯"*) — 다니는 다른 반에 기록하면 출석부에 방문 줄이 안 생긴다. 오늘 정규 반은 목록에서 빠진다(`hostChoicesOf`).
        hostClasses: { options: [], loading: true },
      });
      // 반 필터가 '전체'면 앵커가 없다 — 그때는 **합칠 후보의 반**으로 좁힌다(위 헬퍼의 🔴 참조).
      void loadAbsences(studentId, anchorId ?? candidateAnchorClassId(plan.candidates));
      // 수업 후보도 **합칠 정규 수업의 과목**으로 좁힌다 — 두 과목을 가르치는 선생님이 '전체'에서 추가하면 결석 목록은 정규 수업 과목인데
      // 반 후보에 다른 과목 반이 섞여, 영어 반에 기록하면서 수학 결석에 메모를 달 수 있었다(적대 리뷰 2026-09-21). 과목 키를 모르면 종전대로.
      const candSubjects = mk.subjects.filter((su) => plan.candidates.some((c) => !!c.subjectKey && c.subjectKey === su.subjectKey));
      void loadHostClasses(studentId, candSubjects.length ? candSubjects : mk.subjects);
      return;
    }
    // 합칠 정규 행이 없다(그날 결석·다른 강사 과목 등) → **그래도 묻는다**. 결석 보강이 바로 이 경로라
    // 예전엔 가장 흔한 보강에서 결석분·시수를 물을 자리가 없었다(원장 2026-08-19).
    // 🔴 단 **더할 보강 행이 없으면**(같은 학생을 다시 추가) 창을 열지 않는다 — 열면 수업·시수·결석분을 고르게 해 놓고
    //    하나도 반영하지 못한다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
    if (pendingMakeupRows(existing, mk).length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return;
    }
    setMakeupAsk({
      studentId,
      studentName: existing.name,
      mk,
      candidates: [],
      sentSubjects: [],
      isNew: false,
      absences: EMPTY_ABSENCES,
      absencesLoading: true,
      hostClasses: { options: [], loading: true },
    });
    void loadAbsences(studentId, anchorId);
    void loadHostClasses(studentId, mk.subjects);
  }
  /**
   * 창에 보일 수업 후보 — 🔴 **그 학생이 다니는 반만**(원장 2026-09-21 *"해당 학생의 소속 수업만 띄워"*) · 그 학생이 **오늘 이 화면에
   * 정규 행이 있는 반은 뺀다**: 그 반은 정규 칸이 이미 있어 저장 훅이 보강 칸을 따로 세우지 않는다(합칠 수 없는 결석 등) — 보이면
   * "그 반에 기록합니다"가 지킬 수 없는 약속이 된다. 판정은 [`hostChoicesFor`] 한 곳(확인창도 같은 함수 · 기본값도 이 목록으로 본다).
   */
  function hostChoicesOf(ask: NonNullable<typeof makeupAsk>) {
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
  /** 보강을 기록할 수업 후보를 뒤늦게 채운다 — 창은 먼저 열고 목록만 갈아 끼운다(결석 조회와 같은 모양). */
  async function loadHostClasses(studentId: string, rows: readonly Subject[]) {
    const mine = ++hostSeq.current;
    // 후보는 보강 행 과목의 반만(등록 문이 과목까지 맞춰 본다) — 과목 키를 모르면 거르지 않는다.
    const subjects = [...new Set(rows.map((su) => su.subjectKey).filter((k): k is string => !!k))];
    const res = await fetchMakeupHostClasses(studentId, activeDate, subjects).catch(() => ({ options: [], failed: true }));
    if (mine !== hostSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId && prev.hostClasses
        ? { ...prev, hostClasses: { options: res.options, loading: false, failed: res.failed, noneBlocked: "noneBlocked" in res ? res.noneBlocked : false } }
        : prev,
    );
  }
  /**
   * **보강 반 고르기·바꾸기**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 후보 = 이 학생이 다니는 같은 과목 반(확인창과 같은 목록·같은 함수).
   * 고르면 서버 [`setMakeupClass`]가 보고서의 보강 반·보낼 반과 출석부 칸을 **함께** 옮긴다(보고서 전이면 명단 세션의 보강 반만).
   * 이미 발송된 보강은 서버가 거절한다(회수가 옛 반 기록으로 글을 찾는다).
   */
  async function pickMakeupClass(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    const subjectKey = su?.subjectKey || null;
    if (!su || !su.makeup || su.classId || !subjectKey) return;
    const res = await fetchMakeupHostClasses(student.id, activeDate, [subjectKey]).catch(() => ({ options: [], failed: true }));
    if (res.failed) {
      toast.error(t("os.c.sendClassCheckFail"));
      return;
    }
    const regular = student.subjects.filter((x) => !x.makeup && x.classId).map((x) => x.classId!);
    const options = hostChoicesFor(res.options, regular).filter((o) => o.subject === subjectKey);
    if (!options.length) {
      toast.error(t("os.makeupClass.noChoice"));
      return;
    }
    const picked = await askSendClass({
      studentName: student.name,
      candidates: options.map((o) => ({ id: o.classId, name: o.className })),
      defaultId: su.makeupClassId ?? null,
      makeupClassName: null,
      pickOnly: true,
    });
    if (!picked || picked === su.makeupClassId) return;
    const r = await setMakeupClass({ studentId: student.id, date: activeDate, subject: subjectKey, classId: picked });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    patch(student.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: r.className } : x)),
    }));
    toast.success(tf("os.makeupClass.changed", { name: r.className }));
  }
  /**
   * 결석 후보(이전 반 포함)를 뒤늦게 채운다 — 창은 먼저 열고 목록만 도착하면 갈아 끼운다.
   * 🔴 앵커 반을 함께 넘겨 **그 반 과목**의 결석만 받는다(수학 보강에 영어 결석이 뜨던 것,
   *    원장 제보 2026-08-19). 반 필터가 '전체'라 앵커가 없으면 종전대로 안 거른다.
   */
  async function loadAbsences(studentId: string, anchorClassId: string | null) {
    const mine = ++absenceSeq.current;
    const list = await fetchMakeupAbsences(studentId, activeDate, anchorClassId).catch(
      () => EMPTY_ABSENCES,
    );
    // 🔴 늦게 온 옛 조회는 버린다 — 학생이 같아도 **앵커(과목)가 다르면 다른 목록**이다.
    if (mine !== absenceSeq.current) return;
    setMakeupAsk((prev) =>
      prev && prev.studentId === studentId ? { ...prev, absences: list, absencesLoading: false } : prev,
    );
  }
  /**
   * 보강 빼기 — '+ 보강 학생 추가'의 반대(원장 2026-08-18 *"다 삭제"*). 출결 보강 칸과 저장된 보강
   * 보고서를 함께 지운다(서버 [`removeMakeupEntry`]). 되살아나는 원천이 둘이라 한쪽만 지우면
   * 새로고침에 그대로 돌아온다.
   * ⚠️ 학부모에게 나간 보고서는 **회수 요청만** 걸린다(게시글을 지울 열쇠가 그 행에 있다) — 그때는
   *    화면에서도 행을 지우지 않는다(`keepRow`). 안 그러면 "지웠는데 새로고침하면 있다"가 된다.
   */
  async function removeMakeupRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const su = student.subjects.find((x) => x.name === subjectName);
    if (!su) return;
    // 🔴 **발송된 보강은 애초에 못 뺀다**(원장 2026-08-18 *"발송된건은 보강취소를 못하게 강제해"*).
    //    서버도 같은 판정으로 막지만 여기서 먼저 이유를 말한다 — 확인창을 띄웠다가 실패하면 더 나쁘다.
    const rep = reports[student.id]?.[subjectName];
    const blocked = makeupRemoveBlockReason(rep?.classnoteStatus ?? null);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    // 🔴 앵커가 이 학생의 **정규 반**이면 출결은 지우지 않는다(classId null) — 합칠 후보가 있던 '분리' 보강은 시수를 그 정규 칸에
    //    얹었고 보강 칸을 따로 만들지 않았다. 넘기면 누가 그 정규 칸을 '보강'으로 바꿔 둔 경우 정규 칸이 통째로 지워진다(적대 리뷰 2026-09-21).
    const anchorIsRegular = !!su.makeupClassId && student.subjects.some((x) => !x.makeup && x.classId === su.makeupClassId);
    // 경고는 **무엇이 사라지는지 그대로** 적는다(원장 *"경고하고 확인하면 삭제"*) — 정규 반 앵커면 출결은 안 지우고 남는 것을 밝힌다.
    const lines = [
      tf("os.c.removeMakeupTitle", { name: student.name }),
      "",
      anchorIsRegular
        ? tf("os.c.removeMakeupRegularLine", { cls: todayClasses.find((c) => c.id === su.makeupClassId)?.name ?? su.name })
        : t("os.c.removeMakeupLine1"),
      t("os.c.removeMakeupLine2"),
    ];
    if (!window.confirm(lines.join("\n"))) return;
    const res = await removeMakeupEntry({
      studentId: student.id,
      date: activeDate,
      classId: anchorIsRegular ? null : su.makeupClassId ?? null,
      subject: su.subjectKey ?? null,
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // 확인했으면 **화면에서도 없앤다**(원장 *"아무것도 추가 안한것처럼 이전으로"*) — 지울 수 있는 행만
    // 여기까지 오므로 DB에도 남는 게 없다. 남은 행이 없으면 카드째 목록에서 제거(보강만 있던 학생).
    setStudents((prev) =>
      prev
        .map((s) =>
          s.id === student.id
            ? withMark({
                ...s,
                subjects: s.subjects.filter((x) => x.name !== subjectName),
                // 지운 보강 칸이 배지 재료(`attendanceOffRow`)에 남아 있으면 없는 기록이 배지에 계속 선다.
                ...(!anchorIsRegular && su.makeupClassId && s.attendanceOffRow && su.makeupClassId in s.attendanceOffRow
                  ? {
                      attendanceOffRow: Object.fromEntries(
                        Object.entries(s.attendanceOffRow).filter(([cid]) => cid !== su.makeupClassId),
                      ),
                    }
                  : {}),
              })
            : s,
        )
        .filter((s) => !(s.id === student.id && s.subjects.length === 0)),
    );
    toast.success(res.message);
  }
  /**
   * 다이얼로그 응답 처리 — 고른 대로만 한다. 취소는 아무것도 하지 않는다(보강 행도 안 생긴다).
   * ⚠️ 학생은 **id로 다시 찾는다** — 다이얼로그가 열려 있는 동안 실시간 갱신이 카드를 바꿨을 수 있다.
   */
  async function resolveMakeupAsk(picked: MakeupConfirmChoice) {
    const asked = makeupAsk;
    if (!asked || makeupSaving) return;
    // 🔴 합칠 후보는 **창을 연 순간의 스냅샷**이다 — 그 사이 이 화면이 알게 된 변화(같은 문서 방송·자기 응답의 conflict 되돌리기)로
    //    그 칸이 결석 등이 됐는데 옛 상태로 되쓰면 결석이 출석으로 뒤집히고 옛 시수에 더해진다(적대 리뷰 2026-09-21).
    //    확인하는 순간의 카드로 같은 판정(`planMakeupMerge`)을 다시 돌려, 더는 합칠 수 없으면 멈추고 지금 값으로 이어 간다.
    //    ⚠️ **다른 기기의 변화는 못 본다**(카드는 실시간 구독이 없다) — 그 방어는 서버가 쓰기 때 상태를 다시 보는 것이다(미착수).
    let choice = picked;
    if (picked.candidate) {
      const was = picked.candidate;
      const card = studentsRef.current.find((s) => s.id === asked.studentId);
      const plan = card ? planMakeupMerge(card.subjects, new Set([was.subjectKey])) : null;
      const fresh = plan?.kind === "ask" ? plan.candidates.find((c) => c.name === was.name && c.classId === was.classId) : undefined;
      if (!fresh) {
        setMakeupAsk(null);
        toast.error(tf("os.c.makeupCandidateChanged", { target: was.name }));
        return;
      }
      choice = { ...picked, candidate: fresh };
    }
    // 창에서 **수업을 골랐으면** 그 반이 앵커다(원장 2026-09-21) — 보고서의 `makeup_class_id`와 출결 칸이 모두 그 반을 본다.
    // `null` = '반 없이'(보이지 않는 보강 반 — 종전 동작). 묻지 않았으면(`undefined`) 반 필터 앵커 그대로.
    // 🔴 고른 반과 **과목이 같은 행만** 남긴다 — 다른 과목 행까지 그 반에 묶으면 등록 문이 통째로 거절한다(적대 리뷰 2026-09-21).
    // ⚠️ 카드 표시 이름(`makeupClassName`)은 보고 있던 반 필터가 있으면 그대로(바꾸면 추가한 카드가 그 자리에서 사라진다),
    //    '전체'였으면 고른 반 이름(새로고침 뒤 그 반 칩 아래로 옮겨 가 보이는 것과 같게).
    // 🔴 고른 반은 **지금 창에 보이는 후보**에서 찾는다 — 창이 열린 사이 그 반에 정규 행이 생기면 후보에서 빠지는데,
    //    거르기 전 목록에서 찾으면 요약 문장('보강 반에 기록')과 다른 반으로 나간다(적대 리뷰 2026-09-21).
    const host = choice.hostClassId === undefined || choice.hostClassId === null
      ? null
      : hostChoicesOf(asked)?.options.find((o) => o.classId === choice.hostClassId) ?? null;
    if (typeof choice.hostClassId === "string" && !host) {
      toast.error(t("os.c.makeupHostGone"));
      return;
    }
    // 반 필터가 '전체'였나 — 그때만 카드 이름을 고른 반으로 바꾼다(서버가 tag를 늘 "보강"으로 채워 tag로는 가를 수 없다).
    const filterAll = !asked.mk.subjects.some((su) => su.makeupClassName);
    const hosted = choice.hostClassId === undefined
      ? asked
      : {
          ...asked,
          mk: {
            ...asked.mk,
            ...(host && filterAll ? { tag: host.className, className: host.className } : {}),
            subjects: asked.mk.subjects
              .filter((su) => !host || !su.subjectKey || su.subjectKey === host.subject)
              .map((su) => ({ ...su, makeupClassId: choice.hostClassId ?? null, makeupClassName: su.makeupClassName ?? host?.className ?? null })),
          },
        };
    // 🔴 합칠 후보가 있는 보강을 **분리**하면 보강 줄의 앵커도 고른 정규 수업(후보) 반이다 — 시수가 그 반 칸에 얹히므로(아래),
    //    보고서 저장 훅이 그 반 칸을 보고 보강 반을 또 만들지 않는다(위임 반이면 담임 판정이 못 잡는다). 표시 이름은 그대로 둔다
    //    (바꾸면 추가한 카드가 보던 반 필터에서 그 자리에서 사라진다 — 새로고침 뒤엔 후보 반 칩 아래에 선다).
    const target = choice.candidate && choice.mode === "separate" ? choice.candidate : null;
    // 보던 반 필터가 후보 반과 다르면 새로고침 뒤 카드가 후보 반 칩 아래로 옮겨 간다 — 조용히 옮기지 않고 알린다.
    // ⚠️ 판정은 **이름**으로 — 반 필터가 이름 축이라(grid.ts) 동명 반 필터(앵커 id 없음)에선 옮겨 가지 않는다.
    const targetClassName = target ? todayClasses.find((c) => c.id === target.classId)?.name ?? null : null;
    const movedTo = target && targetClassName && hosted.mk.subjects.some((su) => su.subjectKey === target.subjectKey && !!su.makeupClassName && su.makeupClassName !== targetClassName)
      ? targetClassName
      : null;
    const ask = target
      ? { ...hosted, mk: { ...hosted.mk, subjects: hosted.mk.subjects.map((su) => (su.subjectKey === target.subjectKey ? { ...su, makeupClassId: target.classId } : su)) } }
      : hosted;
    // 창에서 **다른 반**을 골랐는데 보던 반 필터와 이름이 다르면 새로고침 뒤 그 보강은 고른 반 이름 아래로 옮겨 간다 — 그 반이 오늘 칩에
    // 없으면 '전체'에서만 보인다. 조용히 옮기지 않고 알린다(정규 수업이 있는 학생이 다른 반을 고르는 것이 이 경로의 흔한 경우다).
    const hostMoved = host && ask.mk.subjects.some((su) => !!su.makeupClassName && su.makeupClassName !== host.className) ? host.className : null;
    const hostNote = hostMoved
      ? todayClasses.some((c) => c.name === hostMoved)
        ? tf("os.c.makeupShownUnder", { target: hostMoved })
        : tf("os.c.makeupShownUnderAll", { target: hostMoved })
      : undefined;
    const withHostNote = (msg: string) => (hostNote ? `${msg} ${hostNote}` : msg);
    // 🔴 더할 보강 행이 없으면 **등록하기 전에** 멈춘다 — 등록이 먼저 돌면 고른 수업·시수가 세션에 적히는데 카드 행은
    //    옛 앵커 그대로라, 새로고침 뒤 카드가 칸 없는 반을 가리키고 보고서 저장 때 보강 반 칸이 하나 더 선다(적대 리뷰 2026-09-21).
    //    목록에 없던 학생(isNew)이라도 창이 열린 사이 카드가 들어왔을 수 있어 id로 다시 찾는다.
    const cardNow = studentsRef.current.find((s) => s.id === ask.studentId);
    // 🔴 **합침도** 같은 과목 보강 행이 이미 있으면 멈춘다 — 다른 반을 골라 만든 보강 행(`planMakeupMerge`의 `already`는 반에 합친 행만 본다)이
    //    있는 학생을 다시 추가해 합치면 정규 칸에 보강이 한 번 더 얹혀 두 번 잡힌다(재리뷰 2026-09-21).
    const stopSubject = choice.candidate ? choice.candidate.subjectKey : undefined;
    if (cardNow && (!choice.candidate || stopSubject) && pendingMakeupRows(cardNow, ask.mk, stopSubject).length === 0) {
      setMakeupAsk(null);
      setSelId(cardNow.id);
      toast.message(t("os.c.makeupRowExistsNoChange"));
      return;
    }
    if (choice.mode === "separate") {
      const existing = studentsRef.current.find(s => s.id === ask.studentId);
      const attended = new Set(existing?.subjects.filter(su => !su.makeup).map(su => su.subjectKey));
      const attendedRows = ask.mk.subjects.filter(su => attended.has(su.subjectKey));
      const rows = choice.candidate
        ? ask.mk.subjects.filter(su => su.subjectKey === choice.candidate!.subjectKey)
        : attendedRows.length ? attendedRows : ask.mk.subjects;
      setMakeupSaving(true);
      try {
        const result = await registerMakeupEntries({
          studentId: ask.studentId, date: activeDate,
          entries: rows.map(su => ({
            subject: su.subjectKey || su.name, makeupClassId: su.makeupClassId,
            absentDate: choice.absentDate, absentClassId: choice.absentClassId, units: choice.addUnits,
            // 🔴 정규 수업에 기록하지 않는 보강이면 **지금** 앵커 반에 칸을 세운다(서버가 저장 훅과 같은 함수로) — 보고서를 안 쓰거나
            //    저장이 실패해도 시수가 남게(적대 리뷰 2026-09-30). 후보 반에 얹는 분리 보강·그 반에 오늘 정규 줄이 있는 학생은 끈다
            //    (그 칸은 화면이 직접 얹는다 — 옛 `persistAnchorMakeup`과 같은 조건).
            recordCell: !choice.candidate && !!su.makeupClassId && !existing?.subjects.some((x) => x.classId === su.makeupClassId && !x.makeup),
          })),
        });
        if (!result.ok) { toast.error(result.error); return; }
        if (result.cellError) toast.error(tf("os.c.anchorFail", { error: result.cellError }));
        notifyMakeupEffect(result.makeupEffect);
        // 내 리비전에 명단만 더한 경우에만 자동저장 기준도 전진시킨다. 다른 창의 내용에는 소유권을 얻지 않는다.
        if (existing && (existing.sessionUpdatedAt ?? null) === result.previousUpdatedAt) {
          applySessionSaveResult(existing.id, result);
        }
      } catch {
        toast.error(t("os.c.makeupSaveFail"));
        return;
      } finally { setMakeupSaving(false); }
    }
    setMakeupAsk(null);
    const anchorIdNew = ask.mk.subjects.find((su) => su.makeupClassId)?.makeupClassId ?? null;
    // '반 없이'를 골랐는가 — 앵커가 없는 이유가 반 필터가 아니라 강사의 선택이라 문구가 다르다.
    const noAnchorToast = choice.hostClassId === null ? "os.c.makeupAddedNoHost" : "os.c.makeupAddedNoAnchor";
    // 목록에 없던 학생이라도 창이 열린 사이 카드가 실시간으로 들어왔으면 **기존 카드 경로**로 보낸다 — 새 카드 경로로 가면
    // 그 카드의 앵커 칸과 고른 반 칸이 둘 다 선다(적대 리뷰 2026-09-21).
    if (ask.isNew && !studentsRef.current.some((s) => s.id === ask.studentId)) {
      // 목록에 없던 학생 — 확인을 받았으니 이제 카드를 만든다(취소했으면 여기 안 온다).
      const mk = ask.mk;
      setStudents((prev) => (prev.some((s) => s.id === mk.id) ? prev : [...prev, mk]));
      setReports((prev) => ({ ...prev, [mk.id]: initReports([mk], templatePrefsRef.current)[mk.id] ?? {} }));
      setSelId(mk.id);
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(mk.id, anchorIdNew, choice, mk.name, hostNote);
      } else {
        // ⚠️ 앵커(보고 있는 반)가 없으면 출결에 남길 칸이 없다 — 시수를 약속하지 않는다(지킬 수 없다).
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: mk.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: mk.name }),
        );
      }
      return;
    }
    const existing = studentsRef.current.find((s) => s.id === ask.studentId);
    if (!existing) {
      toast.error(t("os.c.cardNotFound"));
      return;
    }
    if (!choice.candidate) {
      // 정규 수업에 기록하지 않는 보강(정규 행이 없음 — 그날 결석·다른 강사 과목 — 또는 창에서 다른 반을 고름) — 보강 행만 만들고
      // 시수·결석분은 앵커 반(고른 반 · 보던 반 필터)에 적는다.
      // 🔴 이미 보강 행이 있으면(같은 학생을 다시 추가) **여기서 멈춘다** — 계속 가면 고른 반에 칸이 하나 더 서서 시수가 두 번 잡히고,
      //    카드 행의 앵커는 옛 값이라 보강 빼기가 그 칸을 못 지운다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
      if (!addSeparateMakeupRows(existing, ask.mk)) return;
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(existing.id, anchorIdNew, choice, existing.name, hostNote);
      } else {
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: existing.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: existing.name }),
        );
      }
      return;
    }
    // 🔴 합칠 후보가 있는 보강은 **보던 반 필터에 보강 칸을 따로 적지 않는다** — 시수는 고른 정규 수업 칸에만 얹힌다(합침·분리 둘 다).
    //    예전엔 여기서 `persistAnchorMakeup`을 불러, 보던 반(X)이 후보 반(Y)과 다르면 **한 번의 보강이 두 반에** 잡혔다
    //    (X 보강 1 + Y +시수 — 실측 2026-08-29 정민성 · 2026-09-17 안서준, 원장 *"출석부에 행만 자꾸 생기네"*).
    if (choice.mode === "separate") {
      // 🔴 **고른 과목의 보강 행만** 만든다. 안 좁히면 그 강사가 가르치는 학생의 다른 과목까지 "(보강)" 행이
      //    딸려 붙어(예: 영어가 오늘 결석이라 후보엔 없어도 행은 생겼다) 보고서가 2건이 아니라 3건 나간다 —
      //    다이얼로그가 "모두 2건" 이라고 약속한 것과 어긋난다. 강사가 어느 수업인지 이미 골랐으니 추측할 게 없다.
      if (addSeparateMakeupRows(existing, ask.mk, true, choice.candidate!.subjectKey)) {
        // 🔴 결석일은 **선택**이다(원장 2026-08-07 *"오늘 날짜에 추가 보강할 수도 있잖아"*). 없으면
        //    결석분 연결 없이 시수만 얹는다. 예전엔 이 분기가 없어 날짜가 비면 **조용히 '합침'으로**
        //    떨어졌다 — 강사는 '분리'를 골랐는데 보고서가 1건만 나가는, 화면과 다른 결과였다.
        const note = movedTo ? tf("os.c.makeupShownUnder", { target: movedTo }) : undefined;
        if (choice.absentDate)
          void linkMakeupAbsence(existing, choice.candidate!, choice.absentDate, choice.addUnits, choice.absentClassId, note);
        else void addMakeupUnitsOnly(existing, choice.candidate!, choice.addUnits, note);
      }
      return;
    }
    mergeMakeupIntoRegular(
      existing,
      choice.candidate,
      choice.addUnits,
      ask.sentSubjects.includes(choice.candidate.name),
    );
  }
  /**
   * 정규 행이 없는 보강의 결석분 연결 — 시수는 **오늘 보강한 반**(앵커)에, 메모는 **결석이 난 반**에.
   * 🔴 이월 보강(반 이동)은 두 반이 다르다 — 하나로 묶으면 옛 반에 시수가 붙어 급여 귀속이 틀린다.
   */
  async function linkMakeupToAbsenceCell(
    studentId: string,
    makeupClassId: string,
    choice: MakeupConfirmChoice,
    name: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 옮겨 가는 반) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    // 🔴 시수는 등록 문(`registerMakeupEntries` — 못 세웠으면 보고서 저장 훅)이 그 반 칸을 세울 때 적었다 — 여기선 **메모만**(합산 액션을 쓰면 두 번 더해진다).
    const res = await noteMakeupAgainstAbsence({
      studentId,
      makeupClassId,
      makeupDate: activeDate,
      absentClassId: choice.absentClassId ?? makeupClassId,
      absentDate: choice.absentDate!,
    });
    if ("error" in res) {
      toast.error(tf("os.c.absenceLinkFail", { error: res.error }));
      return;
    }
    const msg = res.absenceNoted
      ? tf("os.c.makeupNoted", {
          name,
          date: shortDate(choice.absentDate!),
          units: choice.addUnits,
        })
      : tf("os.c.makeupNoRecord", {
          name,
          units: choice.addUnits,
          date: shortDate(choice.absentDate!),
        });
    toast.success(note ? `${msg} ${note}` : msg);
  }
  /**
   * 분리 보강을 **결석분에 연결** — 결석한 날 칸엔 메모만("N/N 보강 예정", 결석 0은 그대로),
   * 보강한 날(=보고 있는 날짜) 칸엔 시수 +addUnits + 메모("N/N 결석분 보강"). 원장 2026-08-06 사양이자
   * 현재 구글시트 출석부 운영과 같은 모양. 낙관 표시는 보강한 날 행에만 반영한다.
   */
  async function linkMakeupAbsence(
    existing: OneScreenStudent,
    target: MergeCandidate,
    absentDate: string,
    addUnits: number,
    absentClassId?: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 카드가 옮겨 가는 반 등) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    const withNote = (msg: string) => (note ? `${msg} ${note}` : msg);
    const res = await linkMakeupToAbsence({
      studentId: existing.id,
      classId: target.classId,
      absentDate,
      // 이월 보강 — 결석이 난 반이 다르면 메모는 그 반 칸에 붙는다(시수는 target 반).
      absentClassId,
      makeupDate: activeDate,
      addUnits,
    });
    if ("error" in res) {
      toast.error(tf("os.c.makeupUnitsFail", { error: res.error }));
      return;
    }
    // 화면의 그 행 시수도 서버 결과로 맞춘다(1이면 서버가 null로 접으므로 같은 규칙으로).
    // ⚠️ 기록이 없던 날엔 서버가 '출석'으로 열었다 — 화면 raw도 같이 present로 맞춰야 표시가 안 갈린다.
    // 조퇴 칸이면 raw는 조퇴 그대로 — 배지는 행에서 다시 계산한다(`studentMarkFromRows`, 조퇴는 '조퇴').
    const linkedRaw = target.attendanceRaw ?? "present";
    applyAttendanceLocal(existing.id, target.classId, linkedRaw, { units: res.units === 1 ? null : res.units });
    if (res.alreadyLinked) {
      toast.message(withNote(tf("os.c.makeupAlreadyLinked", { date: shortDate(absentDate) })));
      return;
    }
    // ⚠️ 결석 기록이 없던 날이면 메모를 안 남긴다 — 조용히 넘기지 말고 그 사실을 밝힌다.
    toast.success(withNote(
      res.absenceNoted
        ? tf("os.c.makeupNoted2", {
            name: existing.name,
            date: shortDate(absentDate),
            target: target.name,
            units: res.units,
          })
        : // 선보강(아직 안 지난 날)이면 "기록이 없다"가 아니라 **아직 오지 않았다**가 사실이다 —
          //    같은 문장으로 뭉뚱그리면 강사가 "왜 기록이 없지?" 하고 출석부를 뒤진다.
          absentDate > activeDate
          ? tf("os.c.makeupFuture", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })
          : tf("os.c.makeupNoRecord2", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })),
      { duration: 8000 },
    );
  }
  /** 합침 — 정규 행에 보강 표시를 켜고(제목 "(정규+보강)", makeup-label.ts) 출석부 수업타임을 얹는다. */
  /**
   * 추가 보강(결석분 연결 없음) — 보강 행은 이미 따로 만들었고, 여기서는 **그 날 칸의 시수만** 올린다.
   * ⚠️ 정규 행에 `makeup: true`를 켜지 않는다 — 그건 '합침'(제목 "(정규+보강)", 보고서 1건)의 표시다.
   *    분리는 보고서가 2건이므로 정규 행은 정규 그대로 둔다.
   */
  function addMakeupUnitsOnly(existing: OneScreenStudent, target: MergeCandidate, addUnits: number, note?: string) {
    const units = (target.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      target.classId,
      mergeStatusOf(target.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 보강 시수 합산은 성공 안내를 이미 띄웠다 — conflict no-op이면 안내가 거짓이 된다
    );
    setSelId(existing.id);
    const msg = tf("os.c.makeupExtra", { name: existing.name, target: target.name, units });
    toast.success(note ? `${msg} ${note}` : msg, { duration: 8000 });
  }

  function mergeMakeupIntoRegular(
    existing: OneScreenStudent,
    merge: MergeCandidate,
    addUnits: number,
    sent: boolean,
  ) {
    patch(existing.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === merge.name ? { ...x, makeup: true } : x)),
    }));
    // 수업타임 = 지금 값(미입력=1) + 강사가 고른 보강 시수. 출결이 비어 있으면 '출석'으로 함께 찍힌다.
    // 🔴 조퇴 칸은 **조퇴 그대로**(`mergeStatusOf`) — 메모(조퇴 사유)는 안 보내므로 서버가 그대로 둔다(원장 2026-09-30).
    // 🔴 보강 시수를 1로 박지 않는다 — 수학은 0.5당 1시간이라 3시간 반의 1회는 1.5다(원장 2026-08-06).
    const units = (merge.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      merge.classId,
      mergeStatusOf(merge.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 합침 시수 합산도 위와 동일 — 비파괴 보호는 알약 첫 체크 전용
    );
    setSelId(existing.id);
    if (sent) {
      // 발송본 잠금이라 보강 내용은 못 싣는다 — 다이얼로그에서 이미 알렸지만 결과도 그대로 밝힌다.
      toast.warning(
        // ⚠️ 숫자 뒤 조사 금지(받침이 값마다 다르다 — 2=이/3=삼) → 수치는 괄호로 뗀다.
        tf("os.c.mergeSent", { name: existing.name, target: merge.name, units }),
        { duration: 10000 },
      );
    } else {
      toast.success(tf("os.c.merged", { name: existing.name, target: merge.name, units }));
    }
  }
  /**
   * 분리 — 종전(2026-08-05 이전)대로 별도 "(보강)" 행. 정규와 별개 보고서라 발송도 따로 나간다.
   * @returns 행이 실제로 늘었는가 — 호출부가 이 값으로 결석분 연결(시수 +1)을 걸지 판단한다.
   */
  /**
   * 이 카드에 **더할 보강 행**(이름 붙이기 전) — `addSeparateMakeupRows`와 창을 열기/등록하기 전 멈춤이 같은 판정을 쓴다.
   * 비어 있으면 같은 과목 보강 행이 이미 있다는 뜻이다.
   */
  function pendingMakeupRows(existing: OneScreenStudent, mk: OneScreenStudent, onlySubjectKey?: string): Subject[] {
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
  function addSeparateMakeupRows(
    existing: OneScreenStudent,
    mk: OneScreenStudent,
    silent = false,
    /** 지정하면 **그 과목 행만** 만든다(다이얼로그에서 강사가 고른 수업). 미지정=종전대로 전 과목 후보. */
    onlySubjectKey?: string,
  ): boolean {
    const studentId = existing.id;
    // 이름 유일화(reports 키 충돌 방지)로 초안 덮어쓰기 차단.
    const used = new Set(existing.subjects.map((su) => su.name));
    const makeupRows = pendingMakeupRows(existing, mk, onlySubjectKey)
      .map((su) => {
        let name = makeupRowName(su.name);
        let n = 2;
        while (used.has(name)) name = makeupRowName(su.name, n++);
        used.add(name);
        // ⚠️ classId=null·makeup=true 유지(반 무관 보강). subjectLabel은 깨끗한 라벨 — 진도 접두에 "(보강)" 누출 방지.
        // 반 필터 앵커(makeupClassId/Name)는 `mk`에 이미 실려 있다 — **'추가'를 누른 시점**의 반 필터라,
        // 다이얼로그를 띄워 두는 동안 강사가 필터를 바꿔도 보강이 엉뚱한 수업에 붙지 않는다.
        return { ...su, name, classId: null, makeup: true, subjectLabel: su.subjectLabel ?? su.name };
      });
    if (makeupRows.length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return false;
    }
    patch(studentId, (s) => ({ ...s, subjects: [...s.subjects, ...makeupRows] }));
    const slots = initReports([{ ...existing, subjects: makeupRows }], templatePrefsRef.current)[existing.id] ?? {};
    setReports((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? {}), ...slots } }));
    setSelId(studentId);
    // 결석분 연결이 뒤따르는 경로(다이얼로그 '분리')는 그쪽 토스트가 시수까지 밝히므로 여기선 조용히(silent).
    setCardSubject({ id: studentId, idx: existing.subjects.length });
    if (!silent) toast.success(tf("os.c.makeupAdded", { name: existing.name }));
    return true;
  }
  return {
    makeupSaving,
    setMakeupSaving,
    makeupAsk,
    setMakeupAsk,
    addMakeupStudent,
    hostChoicesOf,
    pickMakeupClass,
    loadAbsences,
    removeMakeupRow,
    resolveMakeupAsk,
  };
}
