"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createStaff,
  updateStaff,
  type StaffFormState,
} from "@/features/staff/server/actions";
import type { SystemRole } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useModuleOn, useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { phoneLabel } from "@/lib/format/phone";

type Mode = "create" | "edit";

export type StaffFormValue = {
  id?: string;
  displayName: string;
  email: string;
  phone: string | null;
  systemRole: SystemRole;
  hireDate: string | null;
  jobTitle: string | null;
  /** 영어 닉네임(`users.english_name`) — 비우면 이름을 쓰고, 채우면 영어 표면에서 이 값으로 매핑. */
  englishName: string | null;
  subjects: string[];
  defaultClassroom: string | null;
  memo: string | null;
  /** 시간표 강사 헤더 색(ijw Teacher.bgColor 패리티). 글자색은 저장 시 자동 도출. */
  bgColor: string | null;
  /**
   * 학생 출결 알림(클래스노트) 받기 — 켜면 **담당 반과 무관하게 전 학생**의 학부모 출결 연락이 이 계정 벨에 온다.
   * 차량팀·사무실처럼 "누가 오늘 안 오는지"를 통째로 알아야 하는 자리를 위한 스위치(0184a). 미지정=꺼짐.
   */
  attendanceAlertOptin?: boolean;
  /** 랩실 출석부 담당 — 로그인 착지 + 그 자리 쓰기. */
  seatLabDuty?: boolean;
  shuttleDuty?: boolean;
  /** 원어민 선생님(s2_0094) — 담당 과목에 영어가 있을 때만 칸이 보인다. 켜면 업무 완성도 관리에서 빠진다. */
  nativeTeacher?: boolean;
  /** JJ실 출석부 담당. 1차에선 저장만(화면은 아직 안 열림). */
  seatJjDuty?: boolean;
  /** 오늘 출결 데스크 알림 — 강사가 미출결을 출석으로 바꾸면 벨. */
  deskAttendanceOptin?: boolean;
  /** '강사뷰 접근'(0224a) — 다른 강사의 강사뷰 열람(열람 전용) 허용. master(+super_admin) 편집 전용. */
  teacherViewAccess?: boolean;
  /** 강사 화면 기본 언어(0248a) — null/undefined = 지정 없음(이름에서 도출). */
  teacherViewLang?: "ko" | "en" | null;
};

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "등록" : "저장"}
    </Button>
  );
}

export function StaffForm({
  mode,
  initialValue,
  assignableRoleOptions,
  jobTitleOptions = [],
  scope,
  canGrantTeacherView = false,
  canSetNative = false,
}: {
  mode: Mode;
  initialValue?: StaffFormValue;
  assignableRoleOptions: SystemRole[];
  jobTitleOptions?: string[];
  /** 동시 편집 가드 스코프(예: `staff:123`). 수정 모드에서만 — 다른 창 저장 시 경고. */
  scope?: string;
  /** '강사뷰 접근' 토글 노출 — master(+super_admin)만. 서버 액션도 같은 자격일 때만 컬럼을 저장(이중 게이트). */
  canGrantTeacherView?: boolean;
  /** ‘원어민 선생님’을 바꿀 수 있나 — 원장(+운영자) · 보호 계정 아님(s2_0095 DB 가드와 같은 자격). */
  canSetNative?: boolean;
}) {
  const action = mode === "create" ? createStaff : updateStaff;
  const [state, formAction] = useActionState<StaffFormState, FormData>(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });
  const { markSaved } = useUnsavedGuard({ formRef });

  const v: StaffFormValue = initialValue ?? {
    displayName: "",
    email: "",
    phone: null,
    systemRole: assignableRoleOptions[0] ?? "viewer",
    hireDate: null,
    jobTitle: null,
    englishName: null,
    subjects: [],
    defaultClassroom: null,
    memo: null,
    bgColor: null,
  };

  const [bgColor, setBgColor] = useState(v.bgColor ?? "");

  // 담당 과목 = 학원설정(operations.subjects) 단일 소스 — 자유입력(쉼표 구분) 폐기, 설정 과목 토글 칩.
  // 값은 hidden input(name="subjects")에 쉼표 join으로 미러 → 서버 파싱(comma-split)·초안 캡처 불변.
  const subjectMaps = useSubjectMaps();
  // 꺼진 기능(모듈)의 개인 토글은 세우지 않는다(2026-09-30 "꺼지면 흔적 없이"). 🔴 숨길 때도 저장값은 hidden으로
  // 그대로 싣는다 — 체크박스가 폼에서 빠지면 서버가 "꺼짐"으로 읽어 다른 칸을 저장하는 순간 값이 지워진다.
  const classnoteOn = useModuleOn("classnote");
  const seatOn = useModuleOn("seat_attendance");
  const shuttleOn = useModuleOn("shuttle");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(v.subjects);
  const subjectsInputRef = useRef<HTMLInputElement>(null);
  const toggleSubject = (key: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
    // hidden input은 네이티브 이벤트가 없어 초안 자동저장·미저장 가드가 변경을 못 본다 → 폼 이벤트 발화
    // (양쪽 모두 디바운스/setTimeout(0) 뒤 DOM을 읽으므로 React 커밋 후 값이 캡처된다).
    subjectsInputRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  };
  // 설정에서 지워진(레거시) 키가 이미 배정돼 있으면 숨기지 않고 해제 가능한 칩으로 노출(silent drop 방지).
  const settingSubjectKeys = new Set(subjectMaps.options.map((o) => o.value));
  const legacySelectedSubjects = selectedSubjects.filter((k) => !settingSubjectKeys.has(k));
  // 직급 입력(uncontrolled) — 빠른 선택 칩이 값을 채울 수 있게 ref. 칩 클릭 시 input 이벤트를
  // 발화해 초안 자동저장·동시편집 가드가 변경을 포착하게 한다(setter 직접 호출은 이벤트 미발화).
  const jobTitleRef = useRef<HTMLInputElement>(null);
  const pickJobTitle = (t: string) => {
    const el = jobTitleRef.current;
    if (!el) return;
    el.value = t;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  // 로컬 초안 자동저장 — 입력 중 보관, 다시 열면 복구. ⚠️ 임시비번(password)은 보안상 IDB 캡처 제외,
  // 색(bgColor)은 hidden input으로 값 캡처되나 스와치 동기화 위해 onRestore→setBgColor.
  const draft = useFormDraft({
    scope: mode === "create" ? "staff:new" : `staff:${initialValue?.id ?? "edit"}`,
    formRef,
    exclude: ["password"],
    // systemRole은 빈 옵션 없이 항상 첫 역할이 제출되므로 빈 폼 오탐 배너 방지로 의미판정서 제외.
    ignoreForBanner: ["systemRole"],
    onRestore: (vals) => {
      setBgColor(vals.bgColor ?? "");
      // subjects는 hidden 미러(컨트롤드) — DOM 복원만으론 React가 되덮으므로 state rehydrate.
      setSelectedSubjects(
        (vals.subjects ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    },
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 직원관리로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft]);

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}

      {/* 겹치는 칸을 뺐으면 **어디로 갔는지** 적는다 — 없는 걸 찾다가 되돌아 나가는 게 가장 큰 낭비다
          (원장 지시 2026-08-25: 겹치는 건 이력서에서 받고, 이력서에 없는 것만 여기 남긴다). */}
      {mode === "edit" ? (
        <p className="border-line bg-bg-soft text-text-dim rounded-2xl border p-4 text-xs leading-relaxed">
          <b className="text-foreground">여기는 담당·알림·표시 설정만 바꿉니다.</b> 이름·연락처·직급·입사일·
          근무부서·근무형태·이메일은 <b>이력서</b>에서, 비밀번호·역할·삭제는 직원 상세의 <b>계정 관리</b>에서
          바꿉니다.
        </p>
      ) : null}

      {/* 생성 폼은 계정을 만드는 자리라 이메일·비밀번호·역할이 그대로 있다(근무 설정에만 없다). */}
      {mode === "create" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="이름 *" htmlFor="displayName" error={errors.displayName}>
              <input
                id="displayName"
                name="displayName"
                defaultValue={v.displayName}
                required
                placeholder="예: 박지훈"
                className={inputClass}
              />
            </Field>
            <Field label="이메일 *" htmlFor="email" error={errors.email}>
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={v.email}
                required
                placeholder="staff@example.com"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="임시 비밀번호 *" htmlFor="password" error={errors.password}>
            <input
              id="password"
              name="password"
              type="text"
              required
              minLength={8}
              placeholder="8자 이상, 직원에게 직접 안내"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="시스템 권한" htmlFor="systemRole">
              <select
                id="systemRole"
                name="systemRole"
                defaultValue={v.systemRole}
                className={inputClass}
              >
                {assignableRoleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">본인보다 약한 역할만 부여 가능</p>
            </Field>
            {/* "(닉네임)" — 영어 강사는 이 값(예: Charlie T)을 수업에서 닉네임으로 쓴다(라벨만, 데이터 바인딩 불변). */}
            <Field label="직급 (닉네임)" htmlFor="jobTitle">
              <input
                id="jobTitle"
                name="jobTitle"
                ref={jobTitleRef}
                defaultValue={v.jobTitle ?? ""}
                placeholder="직접 입력하거나 아래에서 선택"
                className={inputClass}
              />
              {/* 학원 설정(operations.jobTitles)의 직급을 빠른 선택 칩으로 — 항상 노출(현재 값과 무관).
                  datalist(▼)는 크롬이 입력값으로 제안을 필터링해 "부장" 같은 설정 밖 값이 차 있으면 빈
                  드롭다운처럼 보였다(#오해). 칩은 항상 보이고, 클릭하면 채워지며, 직접 입력도 그대로. */}
              {jobTitleOptions.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {jobTitleOptions.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => pickJobTitle(t)}
                      className="border-line text-text-dim hover:border-primary hover:text-primary rounded border px-2 py-0.5 text-xs transition"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="연락처" htmlFor="phone">
              <input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={phoneLabel(v.phone) ?? ""}
                placeholder="예: 010-1234-5678"
                className={`${inputClass} num`}
              />
            </Field>
            <Field label="채용일" htmlFor="hireDate">
              <input
                id="hireDate"
                name="hireDate"
                type="date"
                defaultValue={v.hireDate ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* 영어 닉네임 — `users.english_name`. 이력서 '영문 이름'(personal.nameEn)과 **다른 값**이다:
            이쪽은 영어 시간표 시트가 `Jane 중1 정규A` 라벨로 강사를 찾는 매칭 키라 근무 설정에 남는다.
            ⚠️ 조건부 렌더 금지 — 숨기면 폼 제출에서 빠지는데 저장은 무조건 이 컬럼을 쓴다(#83류 footgun). */}
        <Field label="영어 닉네임" htmlFor="englishName">
          <input
            id="englishName"
            name="englishName"
            defaultValue={v.englishName ?? ""}
            placeholder="예: Emma"
            className={inputClass}
          />
          <p className="text-muted-foreground mt-1 text-xs">
            비우면 이름을 그대로 씁니다. 채우면 영어 시간표·반 배정에서 이 닉네임으로 매칭됩니다.
          </p>
        </Field>
        <Field label="기본 강의실" htmlFor="defaultClassroom">
          <input
            id="defaultClassroom"
            name="defaultClassroom"
            defaultValue={v.defaultClassroom ?? ""}
            placeholder="예: 301호"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="담당 과목" htmlFor="subjects">
        <input
          ref={subjectsInputRef}
          type="hidden"
          id="subjects"
          name="subjects"
          value={selectedSubjects.join(",")}
        />
        {subjectMaps.options.length > 0 || legacySelectedSubjects.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {subjectMaps.options.map((o) => {
              const active = selectedSubjects.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSubject(o.value)}
                  className={
                    active
                      ? `${SUBJECT_SOFT[subjectMaps.colorOf(o.value)]} rounded border border-transparent px-2.5 py-1 text-xs font-medium transition`
                      : "border-line text-text-dim hover:border-primary hover:text-primary rounded border px-2.5 py-1 text-xs transition"
                  }
                >
                  {active ? <Check className="mr-1 inline size-3" /> : null}
                  {o.label}
                </button>
              );
            })}
            {legacySelectedSubjects.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed
                onClick={() => toggleSubject(k)}
                title="학원 설정에 없는 과목 — 클릭하면 해제"
                className={`${SUBJECT_SOFT[subjectMaps.colorOf(k)]} rounded border border-transparent px-2.5 py-1 text-xs font-medium transition`}
              >
                <Check className="mr-1 inline size-3" />
                {subjectMaps.labelOf(k)}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-text-faint text-xs">
            등록된 과목이 없습니다 — 학원 설정 → 운영 체계에서 과목을 먼저 추가하세요.
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-xs">
          이력서의 근무부서(영어과·수학과…)를 저장하면 자동으로 맞춰집니다 — 겸임일 때만 여기서 조정하세요.
        </p>
      </Field>

      {/* '원어민 선생님'(s2_0094) — 담당 과목에 영어가 있을 때만(원장 2026-11-12 *"근무 설정에 '담당 과목'이 '영어'일 경우 '원어민 선생님' 토글을 두고
          세팅시 노출되지 않게"*). 켜면 업무 완성도 관리 목록에서 빠진다(이름에 한글이 없는 선생님은 켜지 않아도 빠진다).
          표식 칸(`nativeTeacherField`)이 있을 때만 서버가 저장한다 — 영어를 빼면 칸이 사라지고 꺼짐으로 저장된다.
          🔴 원장(+운영자)만 바꾼다(s2_0095 — 켜면 업무 완성도에서 빠지니 관리자 겸 강사가 자기 평가를 끌 수 없게). '강사뷰 접근'과 같은 자격. */}
      {canSetNative ? <input type="hidden" name="nativeTeacherField" value="1" /> : null}
      {canSetNative && selectedSubjects.some((k) => k === "english" || subjectMaps.labelOf(k) === "영어") ? (
      <div className="border-border bg-bg-soft rounded-2xl border p-4">
        <label htmlFor="nativeTeacher" className="flex cursor-pointer items-start gap-3">
          <input
            id="nativeTeacher"
            name="nativeTeacher"
            type="checkbox"
            defaultChecked={v.nativeTeacher === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="space-y-1">
            <span className="text-foreground block text-sm font-medium">원어민 선생님</span>
            <span className="text-muted-foreground block text-xs">
              켜면 업무 완성도 화면의 선생님 목록에서 빠집니다.
            </span>
          </span>
        </label>
      </div>
      ) : null}

      <Field label="시간표 색" htmlFor="bgColor">
        <input type="hidden" name="bgColor" value={bgColor} />
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={bgColor || "#363c41"}
            onChange={(e) => setBgColor(e.target.value)}
            aria-label="강사 색"
            className="border-input h-8 w-12 cursor-pointer rounded border"
          />
          {bgColor ? (
            <>
              <span className="text-text-dim font-mono text-xs">{bgColor}</span>
              <button
                type="button"
                onClick={() => setBgColor("")}
                className="text-text-faint hover:text-foreground text-xs underline"
              >
                지우기
              </button>
            </>
          ) : (
            <span className="text-text-faint text-xs">미설정(기본 해시색)</span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          시간표 강사 헤더 밴드 색(ijw 패리티). 글자색은 자동.
        </p>
      </Field>

      {/* 출결 알림 수신 — 담임에게 일일이 묻지 않고 모아 보게 하는 스위치(원장 2026-08-06).
          ⚠️ 이 계정에는 **전 학생**의 학부모 출결 연락이 들어온다. 반 담당과 무관하다. */}
      {!classnoteOn ? (
        v.attendanceAlertOptin === true ? <input type="hidden" name="attendanceAlertOptin" value="on" /> : null
      ) : (
      <div className="border-border bg-bg-soft rounded-2xl border p-4">
        <label htmlFor="attendanceAlertOptin" className="flex cursor-pointer items-start gap-3">
          <input
            id="attendanceAlertOptin"
            name="attendanceAlertOptin"
            type="checkbox"
            defaultChecked={v.attendanceAlertOptin === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="space-y-1">
            <span className="text-foreground block text-sm font-medium">학생 출결 알림 (클래스노트) 받기</span>
            <span className="text-muted-foreground block text-xs">
              학부모가 클래스노트에 남긴 결석·지각·조퇴 연락을 <b>담당 반과 상관없이 전부</b> 이 계정 알림으로
              받습니다. 차량(셔틀)·사무실처럼 오늘 누가 안 오는지 모아 봐야 하는 자리에 켜세요.
            </span>
          </span>
        </label>
      </div>
      )}

      <div className="border-border bg-bg-soft rounded-2xl border p-4">
        <label htmlFor="deskAttendanceOptin" className="flex cursor-pointer items-start gap-3">
          <input
            id="deskAttendanceOptin"
            name="deskAttendanceOptin"
            type="checkbox"
            defaultChecked={v.deskAttendanceOptin === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="space-y-1">
            <span className="text-foreground block text-sm font-medium">오늘 출결 데스크 알림 받기</span>
            <span className="text-muted-foreground block text-xs">
              강사가 미출결을 출석으로 바꾸면 이 계정 벨로 받습니다. 사무실 자리만 켜세요. 셔틀·학부모
              연락 알림과는 다릅니다.
            </span>
          </span>
        </label>
      </div>

      {!seatOn ? (
        <>
          {v.seatLabDuty === true ? <input type="hidden" name="seatLabDuty" value="on" /> : null}
          {v.seatJjDuty === true ? <input type="hidden" name="seatJjDuty" value="on" /> : null}
        </>
      ) : (
      <div className="border-border bg-bg-soft space-y-3 rounded-2xl border p-4">
        <p className="text-foreground text-sm font-medium">자리 출석부 담당</p>
        <p className="text-muted-foreground text-xs">
          켜면 로그인 후 그 자리 출석부로 바로 들어가고, 그 자리 출결만 찍을 수 있습니다. 다른 메뉴는
          열리지 않습니다.
        </p>
        <label htmlFor="seatLabDuty" className="flex cursor-pointer items-start gap-3">
          <input
            id="seatLabDuty"
            name="seatLabDuty"
            type="checkbox"
            defaultChecked={v.seatLabDuty === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="text-foreground text-sm">랩실 출석부 담당</span>
        </label>
        <label htmlFor="seatJjDuty" className="flex cursor-pointer items-start gap-3">
          <input
            id="seatJjDuty"
            name="seatJjDuty"
            type="checkbox"
            defaultChecked={v.seatJjDuty === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="text-foreground text-sm">JJ실 출석부 담당</span>
        </label>
      </div>
      )}

      {/* '셔틀 담당'(0227a) — 역할을 올리지 않고 셔틀만 여는 개인 토글(원장 2026-08-19:
          "셔틀 선생님을 강사나 관리자 권한을 올리기엔 그렇고, 따로 토글시켜야겠어").
          ⚠️ 편성(정류장·회차·배정) 수정은 열리지 않는다 — 사무실 권한 그대로다. */}
      {!shuttleOn ? (
        v.shuttleDuty === true ? <input type="hidden" name="shuttleDuty" value="on" /> : null
      ) : (
      <div className="border-border bg-bg-soft rounded-2xl border p-4">
        <label htmlFor="shuttleDuty" className="flex cursor-pointer items-start gap-3">
          <input
            id="shuttleDuty"
            name="shuttleDuty"
            type="checkbox"
            defaultChecked={v.shuttleDuty === true}
            className="border-border text-primary focus-visible:ring-ring mt-0.5 size-4 shrink-0 rounded"
          />
          <span className="space-y-1">
            <span className="text-foreground block text-sm font-medium">셔틀 담당</span>
            <span className="text-muted-foreground block text-xs">
              켜면 로그인 후 <b>오늘 등하원</b> 화면으로 바로 들어가고, 학생 승·하차를 찍을 수 있습니다.
              강사·관리자로 올리지 않아도 됩니다. 노선 편성(정류장·회차·배정) 수정과 다른 메뉴는 열리지
              않습니다.
            </span>
          </span>
        </label>
      </div>
      )}

      {canGrantTeacherView ? <p className="text-muted-foreground text-xs">강사뷰 접근은 학원 설정의 역할·권한에서 전체·읽기·없음으로 지정합니다.</p> : null}

      {/* 강사 화면 기본 언어(0248a) — 원장 2026-09-03 *"샘 킴 (sam)도 원어민에 등록"*.
          🔴 **"원어민 여부" 같은 이름의 체크박스로 만들지 말 것** — 그 이름이면 다음 사람이 담임 판정
             (`isKoreanTeacherName`, "원어민은 담임을 맡지 않는다")에 끌어다 쓴다. 김태건은 담임 반이
             4개라 그 순간 시간표 가져오기의 담임 자동채움에서 그 반들이 빠진다. 이 칸은 **화면 글자**뿐이다.
          🔴 '지정 없음'을 기본값으로 남긴다 — "아직 안 정함"과 "한국어로 정함"은 다른 사실이고,
             전자는 나중에 이름 휴리스틱이 좋아지면 따라온다. */}
      <Field label="강사 화면 기본 언어" htmlFor="teacherViewLang">
        <select
          id="teacherViewLang"
          name="teacherViewLang"
          defaultValue={v.teacherViewLang ?? ""}
          className={inputClass}
        >
          <option value="">지정 없음 (이름으로 자동)</option>
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
        <p className="text-muted-foreground mt-1 text-xs">
          지정하지 않으면 이름으로 정해집니다(로마자 이름 = English). 본인이 강사 화면 <b>‘내 메뉴’</b>에서
          고르면 그 값이 우선합니다. 화면에 보이는 글자만 바뀌고 권한·담임·시수는 그대로입니다.
        </p>
      </Field>

      <Field label="메모" htmlFor="memo">
        <textarea
          id="memo"
          name="memo"
          defaultValue={v.memo ?? ""}
          rows={3}
          placeholder="자유 메모"
          className={`${inputClass} resize-y`}
        />
      </Field>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <FormActionBar>
        <SubmitButton mode={mode} />
      </FormActionBar>
    </form>
  );
}

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-foreground block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
