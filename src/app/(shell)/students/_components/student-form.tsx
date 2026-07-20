"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Save } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createStudent,
  updateStudent,
  type StudentFormState,
} from "@/features/students/server/actions";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";

type Mode = "create" | "edit";

export type StudentFormValue = {
  id?: string;
  name: string;
  englishName: string | null;
  classnoteName: string | null;
  grade: string | null;
  school: string | null;
  studentCode: string | null;
  attendanceCode: string | null;
  gender: string | null;
  birthDate: string | null;
  nickname: string | null;
  graduationYear: string | null;
  address: string | null;
  zipCode: string | null;
  addressDetail: string | null;
  email: string | null;
  studentPhone: string | null;
  homePhone: string | null;
  otherPhone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentRelation: string | null;
  status: string;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
};

const GRADES = [
  "초1",
  "초2",
  "초3",
  "초4",
  "초5",
  "초6",
  "중1",
  "중2",
  "중3",
  "고1",
  "고2",
  "고3",
  "기타",
];

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
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

export function StudentForm({
  mode,
  initialValue,
  gradeLevels,
  scope,
}: {
  mode: Mode;
  initialValue?: StudentFormValue;
  gradeLevels?: string[];
  /** 동시 편집 가드 스코프(예: `student:123`). 수정 모드에서만 전달 — 다른 창 저장 시 경고. */
  scope?: string;
}) {
  const action = mode === "create" ? createStudent : updateStudent;
  const [state, formAction] = useActionState<StudentFormState, FormData>(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });
  // 미저장 변경 시 창 닫기(X)·Esc에서 확인. 생성/수정 모두.
  const { markSaved } = useUnsavedGuard({ formRef });

  // 로컬 초안 자동저장 — 입력 중 IDB 보관, 다시 열면 복구 배너. 전 필드 언컨트롤드라 onRestore 불필요.
  // status는 빈 옵션 없이 항상 'prospect' 등 기본값이 제출되므로 빈 폼 오탐 배너 방지로 의미판정서 제외.
  const draft = useFormDraft({
    scope: mode === "create" ? "student:new" : `student:${initialValue?.id ?? "edit"}`,
    formRef,
    ignoreForBanner: ["status"],
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 상세로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved(); // dirty 해제 → 저장 후 닫아도 확인 안 뜸
      if (state.notice) alert(state.notice); // 이름 중복으로 접미사(A·B·C) 강제된 경우 안내
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft]);

  const v = initialValue ?? {
    name: "",
    englishName: null,
    classnoteName: null,
    grade: null,
    school: null,
    studentCode: null,
    attendanceCode: null,
    gender: null,
    birthDate: null,
    nickname: null,
    graduationYear: null,
    address: null,
    zipCode: null,
    addressDetail: null,
    email: null,
    studentPhone: null,
    homePhone: null,
    otherPhone: null,
    parentName: null,
    parentPhone: null,
    parentRelation: null,
    status: "prospect",
    enrolledAt: null,
    withdrawnAt: null,
    notes: null,
  };

  const errors = state?.fieldErrors ?? {};

  // 학년 옵션 = 설정(operations.gradeLevels) 또는 기본. '기타'는 설정과 무관하게 항상 노출(미분류 catch-all).
  // 현재값(v.grade)은 설정 목록에 없어도 합쳐 편집 시 유실 방지.
  const grades = Array.from(
    new Set([...(gradeLevels ?? GRADES), ...(v.grade ? [v.grade] : []), "기타"]),
  );

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="이름 *" htmlFor="name" error={errors.name}>
          <input
            id="name"
            name="name"
            defaultValue={v.name}
            required
            className={inputClass}
            placeholder="예: 김민준"
          />
        </Field>
        <Field label="ClassNote 이름" htmlFor="classnoteName" hint="동명이인 구분용 — 비우면 학생 이름 사용">
          <input
            id="classnoteName"
            name="classnoteName"
            defaultValue={v.classnoteName ?? ""}
            className={inputClass}
            placeholder='예: 김서윤(중2)'
          />
        </Field>
        <Field label="영문 이름" htmlFor="englishName">
          <input
            id="englishName"
            name="englishName"
            defaultValue={v.englishName ?? ""}
            className={inputClass}
            placeholder="예: Minjun Kim"
          />
        </Field>
        <Field label="학년" htmlFor="grade">
          <select id="grade" name="grade" defaultValue={v.grade ?? ""} className={inputClass}>
            <option value="">선택</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="학교" htmlFor="school">
          <input
            id="school"
            name="school"
            defaultValue={v.school ?? ""}
            className={inputClass}
            placeholder="예: 서일고"
          />
        </Field>
        <Field label="학번" htmlFor="studentCode">
          <input
            id="studentCode"
            name="studentCode"
            defaultValue={v.studentCode ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
        <Field label="출결번호" htmlFor="attendanceCode">
          <input
            id="attendanceCode"
            name="attendanceCode"
            inputMode="numeric"
            defaultValue={v.attendanceCode ?? ""}
            className={inputClass}
            placeholder="키오스크 체크인 번호"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="성별" htmlFor="gender">
          <select id="gender" name="gender" defaultValue={v.gender ?? ""} className={inputClass}>
            <option value="">선택</option>
            <option value="male">남</option>
            <option value="female">여</option>
          </select>
        </Field>
        <Field label="생년월일" htmlFor="birthDate">
          <input
            id="birthDate"
            name="birthDate"
            type="date"
            defaultValue={v.birthDate ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="학생 연락처" htmlFor="studentPhone">
          <input
            id="studentPhone"
            name="studentPhone"
            type="tel"
            inputMode="tel"
            defaultValue={v.studentPhone ?? ""}
            className={inputClass}
            placeholder="010-0000-0000"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="원생 집전화" htmlFor="homePhone">
          <input
            id="homePhone"
            name="homePhone"
            type="tel"
            inputMode="tel"
            defaultValue={v.homePhone ?? ""}
            className={inputClass}
            placeholder="053-000-0000"
          />
        </Field>
        <Field label="기타 알림 연락처" htmlFor="otherPhone">
          <input
            id="otherPhone"
            name="otherPhone"
            type="tel"
            inputMode="tel"
            defaultValue={v.otherPhone ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
        <Field label="닉네임" htmlFor="nickname">
          <input
            id="nickname"
            name="nickname"
            defaultValue={v.nickname ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="이메일" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={v.email ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
        <Field label="졸업연도" htmlFor="graduationYear">
          <input
            id="graduationYear"
            name="graduationYear"
            inputMode="numeric"
            defaultValue={v.graduationYear ?? ""}
            className={inputClass}
            placeholder="예: 2027"
          />
        </Field>
        <Field label="우편번호" htmlFor="zipCode">
          <input
            id="zipCode"
            name="zipCode"
            inputMode="numeric"
            defaultValue={v.zipCode ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="주소" htmlFor="address">
          <input
            id="address"
            name="address"
            defaultValue={v.address ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
        <Field label="상세주소" htmlFor="addressDetail">
          <input
            id="addressDetail"
            name="addressDetail"
            defaultValue={v.addressDetail ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="학부모 이름" htmlFor="parentName">
          <input
            id="parentName"
            name="parentName"
            defaultValue={v.parentName ?? ""}
            className={inputClass}
            placeholder="예: 김아버지"
          />
        </Field>
        <Field label="학부모 연락처" htmlFor="parentPhone" error={errors.parentPhone}>
          <input
            id="parentPhone"
            name="parentPhone"
            type="tel"
            defaultValue={v.parentPhone ?? ""}
            className={inputClass}
            placeholder="010-1234-5678"
            inputMode="tel"
          />
        </Field>
        <Field label="보호자 관계" htmlFor="parentRelation">
          <select
            id="parentRelation"
            name="parentRelation"
            defaultValue={v.parentRelation ?? ""}
            className={inputClass}
          >
            <option value="">선택</option>
            <option value="부">부</option>
            <option value="모">모</option>
            <option value="조부">조부</option>
            <option value="조모">조모</option>
            <option value="기타">기타</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="상태" htmlFor="status">
          <select
            id="status"
            name="status"
            defaultValue={v.status}
            className={inputClass}
          >
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="등록일" htmlFor="enrolledAt">
          <input
            id="enrolledAt"
            name="enrolledAt"
            type="date"
            defaultValue={v.enrolledAt ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="퇴원일" htmlFor="withdrawnAt" error={errors.withdrawnAt}>
          <input
            id="withdrawnAt"
            name="withdrawnAt"
            type="date"
            defaultValue={v.withdrawnAt ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="메모 / 특이사항" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          defaultValue={v.notes ?? ""}
          rows={4}
          className={`${inputClass} resize-y`}
          placeholder="자유 메모"
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
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-foreground block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-text-faint text-xs">{hint}</p> : null}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
