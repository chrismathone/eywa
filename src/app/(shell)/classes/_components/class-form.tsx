"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createClass,
  updateClass,
  type ClassFormState,
} from "@/features/classes/server/actions";
import { overlapSummary } from "@/features/classes/overlap";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import {
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { submitAction } from "@/components/forms/submit-action";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { splitGridSlots } from "@/features/classes/grid-slots";
import { ScheduleGrid } from "./schedule-grid";
import { ClassSpecialFields } from "./class-special-fields";
import { ClassReportFields } from "./class-report-fields";
import { ClassEnglishTrackField } from "./class-english-track-field";
import { DEFAULT_ENGLISH_TRACK, normalizeEnglishTrack, type EnglishTrack } from "@/features/classes/english-track";
import { CUSTOM_SLOTS_ANCHOR_ID, CustomTimeSlots } from "./custom-time-slots";
import { OverlapNotice } from "./overlap-notice";
import { ClassNameConflictNotice } from "./class-name-conflict-notice";
import { FREE_CLOSED_NAME_FIELDS } from "@/features/classes/class-name-conflict";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

type Schedule = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId?: string | null;
  classroomId?: string | null;
  /** 저장된 표시 라벨 — 자리(LAB·JJ)면 담당 드롭다운이 그 자리로 열린다. */
  slotTeacherLabel?: string | null;
  /** LAB '따로 수업(*LAB)' 표식(0271a). */
  labSeparate?: boolean;
};

export type ClassFormDefaults = {
  id?: string;
  className: string;
  subject: string;
  teacherId: string | null;
  classroomId: string | null;
  notes: string | null;
  bgColor?: string | null;
  /** 특강 토글값(0133a 컬럼 그대로). 이름 폴백은 서버 판정용이라 폼 체크상태에 섞지 않는다. */
  isSpecial?: boolean;
  reportOptout?: boolean;
  /**
   * 최근 30일 동안 이 반이 ClassNote로 보낸 수업보고서 건수 — '수업보고서 미발송'을 켤 때 경고·확인용(2026-11-04 사고).
   * 편집 화면만 넘긴다 · undefined = 새 반(경고 없음) · null = 못 셌다(그래도 경고) — report-optout-warning.ts.
   */
  recentSentReports?: number | null;
  /** 영어 프로그램 구분(0176a) — 영어 반이 아니면 undefined. */
  englishTrack?: EnglishTrack | null;
  /** 운영 기간 프리필 — 스케줄 슬롯들의 공통값. 슬롯마다 다르면 그 칸은 **비워** 주고 periodMixed로 알린다. */
  validFrom?: string | null;
  validTo?: string | null;
  periodMixed?: "from" | "to" | "both";
  /** 운영이 끝난(이력) 교시 수 — 폼이 건드리지 않는다는 안내용. */
  historyCount?: number;
  /** ⚠️ **현재 유효한 슬롯만** 넘길 것(만료 행을 섞으면 옛 배치가 되살아난다 — 편집 화면 주석 참조). */
  schedules: Schedule[];
  /** '따로 수업(*LAB)' 표식을 읽었는가(getClassById `labSeparateKnown`) — false면 토글을 숨기고 값을 안 보낸다. */
  labSeparateKnown?: boolean;
};

/**
 * ⚠️ pending은 `useActionState`의 세 번째 값 — `useFormStatus`가 아니다. 이 폼은 #83(제출마다 자동
 * 리셋)을 피하려고 `onSubmit`+`submitAction`으로 직접 디스패치하는데, 그러면 네이티브 액션 제출이
 * 아니라서 `useFormStatus().pending`이 계속 false다(= 스피너 없음 + 더블클릭 중복 생성).
 */
function Submit({
  mode,
  pending,
  locked,
}: {
  mode: "create" | "edit";
  pending: boolean;
  /** 생성 직후 겹침 경고가 떠 있는 동안 재제출 잠금 — 다시 누르면 **같은 반이 하나 더** 만들어진다. */
  locked?: boolean;
}) {
  return (
    <Button
      type="submit"
      disabled={pending || locked}
      {...(locked ? { title: "이미 생성되었습니다 — 위 알림의 '확인'을 눌러주세요" } : {})}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "반 생성" : "변경 저장"}
    </Button>
  );
}

export function ClassForm({
  mode,
  defaults,
  teacherOptions,
  classroomOptions,
  subjectOptions,
  periodsConfig,
  scope,
  today,
  showEnglishTrack = true,
  classnoteOn = false,
  readOnly = false,
}: {
  mode: "create" | "edit";
  defaults?: ClassFormDefaults;
  /** 강사 퍼스널 색(bgColor·textColor)을 함께 넘기면 주간 스케줄 격자가 강사 칸을 그 색으로 칠한다. */
  teacherOptions: { id: string; name: string; bgColor?: string | null; textColor?: string | null }[];
  classroomOptions: { id: string; name: string; capacity: number | null }[];
  subjectOptions?: { value: string; label: string }[];
  /** 테넌트 교시설정 → 클릭그리드의 교시→시각. 미전달 시 기본 교시표. */
  periodsConfig?: PeriodsConfig;
  /** 동시 편집 가드 스코프(예: `class:123`). 수정 모드에서만 — 다른 창 저장 시 경고. */
  scope?: string;
  /** KST 오늘(`YYYY-MM-DD`) — 운영 기간 고지 계산용. **서버가 넘긴다**([[#108]] 하이드레이션). */
  today: string;
  /**
   * 영어 프로그램 구분(EiE / 인재원 영어) 칸을 보일지 — EiE 모듈이 꺼진 학원(새 학원 기본)은 안 보인다(2026-09-22 방향 B).
   * 안 그리면 폼에 `englishTrack`이 없어 서버가 새 반은 미분류(null)로 두고, 수정은 기존 값을 건드리지 않는다.
   */
  showEnglishTrack?: boolean;
  /** 이 지점이 ClassNote 모듈을 쓰나(`classnoteModuleOn`) — 꺼진 지점엔 보고서 칸의 ClassNote 문장을 안 보인다(기본 false). */
  classnoteOn?: boolean;
  /**
   * 쓰기 권한이 없다 — 주소로 바로 들어온 읽기 권한 사용자(원장 2026-11-05 — lib/write-lock.ts).
   * 판정은 page.tsx(서버)가 저장 액션 게이트와 **같은 함수**로 계산해 내린다(새 반 = `canManageTenant(role, "classes")`).
   * 켜지면 모든 입력칸(시간표 격자 포함)을 `<fieldset disabled>`로 한 번에 끄고, 저장 단추·초안 복원·행 추가/삭제는 그리지 않는다.
   */
  readOnly?: boolean;
}) {
  // 🔴 과목 선택지는 학원설정 단일 소스 — 서버 부모가 안 주면 셸의 `OperationsProvider`에서 읽는다
  //    (옛 `DEFAULT_SUBJECT_OPTIONS` 하드코딩 폐기, 감사 D9 · CLAUDE.md "운영 enum 하드코딩 금지").
  const subjectMaps = useSubjectMaps();
  const subjects = subjectOptions ?? subjectMaps.options;
  const action = mode === "create" ? createClass : updateClass;
  const [state, formAction, pending] = useActionState<ClassFormState, FormData>(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });
  const { markSaved } = useUnsavedGuard({ formRef });

  // 과목은 교시표(8↔10교시)를 좌우하므로 상태로 들어 그리드와 동기. select는 name=subject로 그대로 제출.
  const [subject, setSubject] = useState(defaults?.subject ?? subjects[0]?.value ?? "math");
  const periods = subjectWeekdayPeriods(subject, periodsConfig);
  // 주말(토·일) 교시는 평일과 시각이 달라 그리드에 별도로 넘긴다(주말은 과목 무관 = config.weekend).
  const weekendPeriods = subjectWeekendPeriods(periodsConfig);
  // 담임도 상태로 — 그리드 셀이 담임 이름을 표시하고, 교시별 부담임 드롭다운의 "담임" 기본값으로 쓴다.
  const [teacherId, setTeacherId] = useState(defaults?.teacherId ?? "");
  // 반 색상(시간표 통합뷰 헤더색) — 빈 문자열=미지정(과목색 폴백). 글자색은 서버가 휘도로 자동.
  const [bgColor, setBgColor] = useState(defaults?.bgColor ?? "");
  // 특강 토글 — 컨트롤드(초안 복원 시 onRestore로 rehydrate해야 하므로 state로 든다).
  const [isSpecial, setIsSpecial] = useState(defaults?.isSpecial ?? false);
  const [reportOptout, setReportOptout] = useState(defaults?.reportOptout ?? false);
  // 영어 프로그램(0176a) — 과목이 영어일 때만 칸이 뜬다. 기본은 인재원 영어(미분류와 같은 칸에 보이게).
  const [englishTrack, setEnglishTrack] = useState<EnglishTrack>(defaults?.englishTrack ?? DEFAULT_ENGLISH_TRACK);
  // 초안 복원용 — 복원된 스케줄을 그리드 initial로 주고 key를 바꿔 remount(그리드는 initial을 마운트 1회만 읽음).
  const [gridKey, setGridKey] = useState(0);
  // 스케줄을 "교시 클릭그리드로 표현되는 것"과 "자유 시각 행"으로 나눈다 — 교시표에 없는 시각의 슬롯은
  // 그리드가 못 그려서, 안 나누면 저장 시 통째로 삭제된다(오전 특강도 이 경로로만 만들 수 있다).
  // 마운트 1회 계산(그리드의 initial 해석과 같은 시점·같은 교시표를 쓰기 위해).
  const [initialSplit] = useState(() =>
    splitGridSlots({
      slots: defaults?.schedules ?? [],
      // 마운트 시점의 과목 = subject state 초기값과 같은 식(교시표가 갈리면 그리드와 자유행이 어긋난다).
      weekdayPeriods: subjectWeekdayPeriods(
        defaults?.subject ?? subjects[0]?.value ?? "math",
        periodsConfig,
      ),
      weekendPeriods: subjectWeekendPeriods(periodsConfig),
    }),
  );
  const [restoredSplit, setRestoredSplit] = useState<{
    grid: Schedule[];
    custom: Schedule[];
  } | null>(null);
  const split = restoredSplit ?? initialSplit;
  /**
   * '시각 직접 입력' 행 수 — 클릭그리드 옆 "교시표 밖 시각 N개" 경고 배지가 쓴다.
   * 🔴 두 컴포넌트의 **상태를 합치지 않는다** — 행 값은 CustomTimeSlots가 그대로 들고, 여기는 개수만 받는다.
   *    (그리드는 `schedule_*`, 자유행은 `custom_*` hidden 네임스페이스라 저장 경로는 서로 무관하다.)
   */
  const [customCount, setCustomCount] = useState(split.custom.length);

  // 로컬 초안 자동저장 — 스케줄(그리드 hidden input schedule_*_${i})·과목·담임·색까지 onRestore로 rehydrate.
  const draft = useFormDraft({
    scope: mode === "create" ? "class:new" : `class:${defaults?.id ?? "edit"}`,
    formRef,
    onRestore: (vals) => {
      if (vals.subject) setSubject(vals.subject);
      setTeacherId(vals.teacherId ?? "");
      setBgColor(vals.bgColor ?? "");
      // 체크박스는 applyFormValues가 DOM만 건드려 컨트롤드 state와 갈라진다 → 여기서 함께 맞춘다.
      setIsSpecial(vals.isSpecial === "true");
      // ⚠️ **키가 있을 때만** 반영한다 — 이 필드가 없던 시절의 초안(또는 이 칸을 안 그린 폼)을 복구할 때
      //    무조건 false로 덮으면, 켜 두었던 토글이 사용자 모르게 꺼진 채 저장된다.
      if (vals.reportOptout !== undefined) setReportOptout(vals.reportOptout === "true");
      // 라디오도 applyFormValues가 DOM만 건드려 컨트롤드 state와 갈라진다 → 함께 맞춘다.
      // ⚠️ 모르는 값이면 손대지 않는다(이 칸이 없던 초안이 선택을 되돌리지 않게).
      const restoredTrack = normalizeEnglishTrack("english", vals.englishTrack);
      if (restoredTrack) setEnglishTrack(restoredTrack);
      // ⚠️ 같은 이름의 hidden("0")까지 applyFormValues가 초안값("true"/"")으로 덮어쓴다 → 복구 후 토글을
      // **끄고 저장해도** getAll에 "true"가 남아 특강으로 저장된다. 마커를 원래 값으로 되돌려 놓는다.
      // (hidden+체크박스 쌍을 쓰는 토글은 **전부** 여기서 마커를 되돌려야 한다 — 새 토글 추가 시 함께.)
      for (const name of ["isSpecial", "reportOptout"]) {
        const marker = formRef.current?.querySelector(`input[type="hidden"][name="${name}"]`);
        if (marker instanceof HTMLInputElement) marker.value = "0";
      }
      // schedule_*_${i} / custom_*_${i} 인덱스 hidden을 스케줄 배열로 복원 → 그리드·자유행 remount.
      // (applyFormValues는 DOM만 건드려 컨트롤드 state와 갈라진다 — 두 컴포넌트 모두 initial로 다시 받는다.)
      const readNs = (prefix: string): Schedule[] => {
        const out: Schedule[] = [];
        for (let i = 0; vals[`${prefix}day_${i}`] !== undefined; i++) {
          out.push({
            dayOfWeek: vals[`${prefix}day_${i}`]!,
            startTime: vals[`${prefix}start_${i}`] ?? "",
            endTime: vals[`${prefix}end_${i}`] ?? "",
            teacherId: vals[`${prefix}teacher_${i}`] || null,
            classroomId: vals[`${prefix}classroom_${i}`] || null,
            // 표식 — 초안에 있으면 그 값, **없으면(표식이 없던 시절의 초안) 저장된 값**으로. 비워 두면 격자가 꺼진 채
            // 열려 "0"을 보내 켜 둔 표식이 저장 한 번에 꺼진다(리뷰 2026-09-17).
            labSeparate:
              vals[`${prefix}labsep_${i}`] !== undefined
                ? vals[`${prefix}labsep_${i}`] === "1"
                : (defaults?.schedules ?? []).some(
                    (d) =>
                      d.labSeparate === true &&
                      d.dayOfWeek === vals[`${prefix}day_${i}`] &&
                      d.startTime.slice(0, 5) === (vals[`${prefix}start_${i}`] ?? "").slice(0, 5),
                  ),
          });
        }
        return out;
      };
      const restoredCustom = readNs("custom_");
      setRestoredSplit({ grid: readNs("schedule_"), custom: restoredCustom });
      // 자유행이 remount되며 내부 상태가 초기화되므로 배지가 쓰는 개수도 함께 맞춘다.
      setCustomCount(restoredCustom.length);
      setGridKey((k) => k + 1);
    },
    // periodProvided·periodKeepValidTo는 값이 항상 "1"인 마커라 "사용자가 뭔가 입력했다"는 신호가
    // 아니다(빈 폼 오탐 방지).
    ignoreForBanner: ["periodProvided", "periodKeepValidTo"],
    // 읽기 권한이면 초안을 쓰지도 복원하지도 않는다 — 끈 칸에 예전 초안이 채워지면 쓸 수 있는 것처럼 보인다.
    enabled: !readOnly,
  });
  const clearDraft = draft.clear;

  // 🔴 겹침(강의실·강사)은 **저장을 막지 않는다**(원장 확정 2026-07-22). 저장은 이미 끝난 상태로 오고,
  // 여기서는 "몇 개 반과 몇 건 겹치는지"를 보여줄 뿐이다. 사용자가 '확인'을 누른 nonce만 기억해 패널을 닫는다.
  // (setState-in-effect(#25) 회피 — 표시 여부는 state에서 파생, ack만 사용자 클릭으로 갱신.)
  const [ackedNonce, setAckedNonce] = useState<number | undefined>(undefined);
  const overlaps = state?.ok ? (state.overlaps ?? []) : [];
  const showOverlaps = overlaps.length > 0 && state?.nonce !== ackedNonce;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 상세로 이동(서버 redirect 대체, B-2).
  // ⚠️ 겹침이 있으면 **이동을 붙잡는다** — 즉시 상세로 넘어가면 경고가 화면에서 사라진다(원장 최우선 요구).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved();
      // 반 수정(요일·교시·운영 기간)은 회차 확정의 예정 시수를 바꾼다 — 새 반 만들기는 수강이 없어 무관.
      if (mode === "edit") notifyTermPlansChanged();
      if ((state.overlaps?.length ?? 0) === 0 && state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft, mode]);

  // 폼 하단 인라인 알림을 놓치지 않게 가운데(top-center) 토스트 병행.
  // state 참조가 바뀔 때(=매 제출 결과)만 발화 → 같은 겹침으로 재저장해도 다시 알림.
  const notifiedState = useRef<ClassFormState>(undefined);
  useEffect(() => {
    if (state === notifiedState.current) return;
    notifiedState.current = state;
    if (state?.error) {
      conflictToast(state.error);
      return;
    }
    // 반 이름 충돌 — 칸은 폼 맨 위라 저장 바에서 누른 사람이 못 볼 수 있다. 같은 문구를 가운데 알림으로도.
    if (state?.nameConflict) {
      conflictToast(state.nameConflict.message);
      return;
    }
    const saved = state?.ok ? (state.overlaps ?? []) : [];
    if (saved.length > 0) conflictToast(`저장했습니다 — ${overlapSummary(saved)}`);
  }, [state]);

  const fieldErrs = state?.fieldErrors ?? {};
  const nameConflict = state?.nameConflict ?? null;
  // "그 반 이름을 바꾸고 저장" — **누른 경우에만** 플래그를 실어 같은 폼을 다시 보낸다(서버가 그 반을 다시 확인한다).
  // ⚠️ submitAction과 같은 이유로 직접 디스패치(#83) — 폼 자동 리셋이 없어 입력값이 그대로 남는다.
  const freeClosedName = () => {
    const form = formRef.current;
    if (!form || !nameConflict?.freeTo) return;
    // 직접 보내는 길이라 브라우저 제출 검사를 안 거친다 — 미발송 확인 체크(class-report-optout-confirm.tsx) 등을 여기서 같이 본다.
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    fd.set(FREE_CLOSED_NAME_FIELDS.flag, "1");
    fd.set(FREE_CLOSED_NAME_FIELDS.name, nameConflict.name);
    fd.set(FREE_CLOSED_NAME_FIELDS.holderId, nameConflict.holderId);
    fd.set(FREE_CLOSED_NAME_FIELDS.to, nameConflict.freeTo);
    startTransition(() => formAction(fd));
  };
  const confirmOverlaps = () => {
    setAckedNonce(state?.nonce);
    if (state?.redirectTo) router.push(state.redirectTo);
  };

  // ⚠️ `action={formAction}` 금지(#83) — 겹침 경고로 이동을 붙잡으면 폼이 화면에 남는데, React 19는
  // 액션 제출마다 form.reset()을 걸어 컨트롤드 state와 DOM이 갈라진다(저장 직후 재저장 = 직전 저장 되돌림).
  return (
    <form
      onSubmit={(e) => {
        // 저장 단추가 없어도 Enter 제출 같은 우회로를 닫는다 — 진짜 거절은 서버 게이트(requireClassManage·requireClassWrite).
        if (readOnly) {
          e.preventDefault();
          return;
        }
        submitAction(e, formAction);
      }}
      ref={formRef}
      className="space-y-5"
    >
      {readOnly ? (
        <p className="text-text-dim border-border bg-muted/40 rounded-md border px-3 py-2 text-sm">
          {writeLockedNote("classes")}
        </p>
      ) : (
        <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      )}
      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {/* 🔴 읽기 권한이면 아래 입력칸 전부(시간표 격자 버튼·드롭다운 포함)를 fieldset 하나로 끈다 — 칸마다 따로 끄면
          새 칸을 더할 때 빠뜨린다. `min-w-0`·테두리 0 = fieldset 기본 모양이 레이아웃을 바꾸지 않게. */}
      <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-5 border-0 p-0">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 이름 충돌이면 문구·버튼을 ClassNameConflictNotice가 함께 그린다(같은 문구가 두 번 뜨지 않게 Field 오류는 비운다). */}
        <Field label="반 이름" {...(nameConflict || !fieldErrs.className ? {} : { error: fieldErrs.className })}>
          <input
            name="className"
            required
            defaultValue={defaults?.className ?? ""}
            placeholder={readOnly ? writeLockedPlaceholder("classes") : "예: 중3 수학 심화반"}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
          {nameConflict ? (
            <ClassNameConflictNotice conflict={nameConflict} pending={pending} onFree={freeClosedName} />
          ) : null}
        </Field>

        <Field label="과목" error={fieldErrs.subject}>
          <select
            name="subject"
            aria-label="과목"
            aria-invalid={fieldErrs.subject ? true : undefined}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="강사">
          <select
            name="teacherId"
            aria-label="강사"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">미정</option>
            {teacherOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="강의실">
          <select
            name="classroomId"
            aria-label="강의실"
            defaultValue={defaults?.classroomId ?? ""}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">미정</option>
            {classroomOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` (정원 ${r.capacity})` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="반 색상 (시간표·스케줄)" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            <input type="hidden" name="bgColor" value={bgColor} />
            <input
              type="color"
              value={bgColor || "#363c41"}
              onChange={(e) => setBgColor(e.target.value)}
              className="border-border bg-card size-9 cursor-pointer rounded-md border"
              aria-label="반 배경색"
            />
            {bgColor ? (
              <>
                <span className="text-text-dim font-mono text-xs">{bgColor}</span>
                <button
                  type="button"
                  onClick={() => setBgColor("")}
                  className="text-text-dim hover:text-foreground text-xs underline"
                >
                  색 없음(과목색)
                </button>
              </>
            ) : (
              <span className="text-text-faint text-xs">미지정 — 과목 기본색 사용</span>
            )}
          </div>
        </Field>

{/* '활성' 체크박스 폐지(2026-07-21 원장 확정) — 같은 `is_active`를 쓰는 문이 둘인데 **뒷정리는 하나만**
    했다. '반 폐지' 버튼은 그 반 활성 수강도 함께 종료하는데, 이 체크박스는 플래그만 꺼서 시간표·출석부에선
    사라지지만 **학생목록·학생상세엔 "수강중"으로 남는** 사각지대를 되살렸다(2026-07-15에 고친 그 버그).
    라벨의 "학생목록에 노출"도 이 경로에선 거짓이었다. → 끄고 켜는 것은 **반 상세의 '반 폐지/재운영' 단일 경로**로. */}
        <Field label="메모" className="sm:col-span-2">
          <textarea
            name="notes"
            rows={2}
            defaultValue={defaults?.notes ?? ""}
            placeholder={readOnly ? writeLockedPlaceholder("classes") : "반 운영에 대한 메모 (선택)"}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <ClassSpecialFields
        isSpecial={isSpecial}
        onSpecialChange={setIsSpecial}
        defaultValidFrom={defaults?.validFrom ?? ""}
        defaultValidTo={defaults?.validTo ?? ""}
        today={today}
        // 운영 기간은 교시 행에 저장된다 — 폼이 교시를 하나도 안 들고 있으면 날짜를 넣어도 적을 자리가 없다.
        // ⚠️ 그리드에서 방금 고른 칸은 여기 안 세어진다(그리드가 개수를 알리지 않는다) — 사전 고지가
        //    조금 늦게 사라질 뿐이고, 실제 거절은 서버가 제출 값으로 판정한다.
        hasSlots={(defaults?.schedules?.length ?? 0) + customCount > 0}
        {...(fieldErrs.period ? { periodError: fieldErrs.period } : {})}
        {...(defaults?.periodMixed ? { periodMixed: defaults.periodMixed } : {})}
        {...(defaults?.historyCount ? { historyCount: defaults.historyCount } : {})}
        {...(fieldErrs.validTo ? { validToError: fieldErrs.validTo } : {})}
      />

      {subject === "english" && showEnglishTrack ? (
        <ClassEnglishTrackField value={englishTrack} onChange={setEnglishTrack} />
      ) : null}

      <ClassReportFields
        reportOptout={reportOptout}
        onReportOptoutChange={setReportOptout}
        initialReportOptout={defaults?.reportOptout ?? false}
        recentSentReports={defaults?.recentSentReports}
        subject={subject}
        classnoteOn={classnoteOn}
      />

      <section className="space-y-3 border-t pt-4">
        <header>
          <h3 className="text-foreground text-sm font-bold">주간 스케줄</h3>
          <p className="text-muted-foreground text-xs break-keep">
            요일 × 교시 칸을 눌러 수업 교시를 지정하세요. 교시표에 없는 시간대(방학 오전 특강 등)는 아래
            &lsquo;시각 직접 입력&rsquo;에 넣습니다. 강의실·강사 시간이 다른 반과 겹쳐도 저장은 됩니다 —
            저장 후 겹치는 반을 자세히 알려드립니다(합반 등 의도된 겹침 허용).
          </p>
          <p className="text-muted-foreground text-xs break-keep">
            수업 시간을 하나도 지정하지 않으면 이 반은 시간표에 나타나지 않습니다.
          </p>
        </header>

        {fieldErrs.schedules ? (
          <p className="text-chart-4 text-xs">{fieldErrs.schedules}</p>
        ) : null}

        <ScheduleGrid
          key={gridKey}
          weekdayPeriods={periods}
          weekendPeriods={weekendPeriods}
          initial={split.grid}
          teacherId={teacherId || null}
          teacherOptions={teacherOptions}
          classroomOptions={classroomOptions.map((c) => ({ id: c.id, name: c.name }))}
          bgColor={bgColor || null}
          allowSeats={subject === "english"}
          // 생성 폼엔 표식을 안 연다 — 새 반 저장(createClass)은 자리 라벨 자체를 아직 안 쓴다.
          labSeparateEnabled={mode === "edit" && defaults?.labSeparateKnown === true}
          outsideCount={customCount}
          onJumpToOutside={() =>
            document
              .getElementById(CUSTOM_SLOTS_ANCHOR_ID)
              ?.scrollIntoView({ behavior: "smooth", block: "center" })
          }
        />

        {/* 교시표에 없는 시각(방학 오전 특강·불규칙 배치) — 클릭그리드가 표현 못 하는 슬롯의 유일한
            입력·보존 경로. 여기 없으면 그런 슬롯은 저장 한 번에 조용히 삭제된다. */}
        <CustomTimeSlots
          key={`custom-${gridKey}`}
          initial={split.custom}
          onCountChange={setCustomCount}
          readOnly={readOnly}
        />
      </section>
      </fieldset>

      {/* 겹침 상세 — 저장 성공 뒤에만 뜬다(차단 아님). '확인'을 눌러야 상세로 이동한다. */}
      {showOverlaps ? (
        <OverlapNotice
          items={overlaps}
          onConfirm={confirmOverlaps}
          // 생성 모드엔 '계속 편집'을 주지 않는다 — 반은 이미 만들어졌고 재제출하면 **중복 생성**된다.
          {...(mode === "edit" ? { onStay: () => setAckedNonce(state?.nonce) } : {})}
        />
      ) : null}
      {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

      {/* 읽기 권한이면 저장 단추를 **그리지 않는다**(비활성으로 남기지 않는다 — write-lock.ts 규칙 1). */}
      {readOnly ? null : (
        <FormActionBar>
          <Submit mode={mode} pending={pending} locked={mode === "create" && showOverlaps} />
        </FormActionBar>
      )}
    </form>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-foreground block text-sm font-medium">{label}</label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
