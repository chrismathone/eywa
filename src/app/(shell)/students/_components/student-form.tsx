"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createStudent,
  updateStudent,
  type StudentFormState,
} from "@/features/students/server/actions";
import type { TeacherOption } from "@/features/students/server/queries";

type Mode = "create" | "edit";

export type StudentFormValue = {
  id?: string;
  name: string;
  englishName: string | null;
  grade: string | null;
  school: string | null;
  studentCode: string | null;
  attendanceCode: string | null;
  gender: string | null;
  birthDate: string | null;
  address: string | null;
  email: string | null;
  studentPhone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  status: string;
  primaryTeacherId: string | null;
  secondaryTeacherId: string | null;
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
  teachers,
  gradeLevels,
}: {
  mode: Mode;
  initialValue?: StudentFormValue;
  teachers: TeacherOption[];
  gradeLevels?: string[];
}) {
  const action = mode === "create" ? createStudent : updateStudent;
  const [state, formAction] = useActionState<StudentFormState, FormData>(action, undefined);

  const v = initialValue ?? {
    name: "",
    englishName: null,
    grade: null,
    school: null,
    studentCode: null,
    attendanceCode: null,
    gender: null,
    birthDate: null,
    address: null,
    email: null,
    studentPhone: null,
    parentName: null,
    parentPhone: null,
    status: "prospect",
    primaryTeacherId: null,
    secondaryTeacherId: null,
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
    <form action={formAction} className="space-y-5">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Field label="주소" htmlFor="address">
          <input
            id="address"
            name="address"
            defaultValue={v.address ?? ""}
            className={inputClass}
            placeholder="(선택)"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Field label="담임" htmlFor="primaryTeacherId">
          <select
            id="primaryTeacherId"
            name="primaryTeacherId"
            defaultValue={v.primaryTeacherId ?? ""}
            className={inputClass}
          >
            <option value="">선택</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="부담임" htmlFor="secondaryTeacherId">
          <select
            id="secondaryTeacherId"
            name="secondaryTeacherId"
            defaultValue={v.secondaryTeacherId ?? ""}
            className={inputClass}
          >
            <option value="">선택</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
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

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <SubmitButton mode={mode} />
      </div>
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
