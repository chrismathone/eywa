"use client";

import { useActionState, useEffect, useRef } from "react";
import { useModuleOn } from "@/features/owner/operations-context";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  Save,
} from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createStudent,
  updateStudent,
  type StudentFormState,
} from "@/features/students/server/actions";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { WithdrawalReasonSlot } from "./withdrawal-reason-slot";
import { SIBLING_FIELD_NAMES, SiblingsField } from "./siblings-field";
import { Guardian2Field } from "./guardian2-field";
import { Field, inputClass } from "./student-form-field";
import { GUARDIAN_RELATIONS } from "@/features/students/guardian";
import type { SiblingOption } from "@/features/students/siblings";

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
  /** 보호자2(s2_0022) — 셋 중 하나라도 있으면 보호자2 줄이 열린 채로 뜬다. */
  parent2Name: string | null;
  parent2Phone: string | null;
  parent2Relation: string | null;
  status: string;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
};

const GRADES = [
  "6세",
  "7세",
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
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Save className="size-4" />
      )}
      {mode === "create" ? "등록" : "저장"}
    </Button>
  );
}

export function StudentForm({
  mode,
  initialValue,
  gradeLevels,
  scope,
  showClassnoteName = true,
  canManageStatus = false,
  siblings,
}: {
  mode: Mode;
  canManageStatus?: boolean;
  initialValue?: StudentFormValue;
  gradeLevels?: string[];
  /**
   * 'ClassNote 이름' 칸을 보일지 — ClassNote 모듈이 꺼진 학원(새 학원 기본)은 안 보인다(2026-09-22 방향 B).
   * 🔴 숨겨도 **저장값은 hidden으로 그대로 싣는다** — 칸이 없으면 서버가 빈 값을 받아 기존 이름을 지운다.
   */
  showClassnoteName?: boolean;
  /** 동시 편집 가드 스코프(예: `student:123`). 수정 모드에서만 전달 — 다른 창 저장 시 경고. */
  scope?: string;
  /** 수정 화면의 형제 칸(0376a) — 짝 표가 있을 때만 준다(없으면 칸이 없고 저장도 형제를 건드리지 않는다). */
  siblings?: { initial: SiblingOption[]; review: SiblingOption[]; suggested: string[] };
}) {
  const kioskOn = useModuleOn("kiosk");
  const action = mode === "create" ? createStudent : updateStudent;
  const [state, formAction] = useActionState<StudentFormState, FormData>(
    action,
    undefined,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });
  // 미저장 변경 시 창 닫기(X)·Esc에서 확인. 생성/수정 모두.
  const { markSaved } = useUnsavedGuard({ formRef });

  // 로컬 초안 자동저장 — 입력 중 IDB 보관, 다시 열면 복구 배너. 전 필드 언컨트롤드라 onRestore 불필요.
  // status는 빈 옵션 없이 항상 'prospect' 등 기본값이 제출되므로 빈 폼 오탐 배너 방지로 의미판정서 제외.
  const draft = useFormDraft({
    scope:
      mode === "create"
        ? "student:new"
        : `student:${initialValue?.id ?? "edit"}`,
    formRef,
    ignoreForBanner: ["status"],
    // 형제 칸은 화면 상태(숨은 칸)라 초안으로 되살리면 보이는 칩과 저장값이 갈린다 — 초안에서 뺀다.
    exclude: SIBLING_FIELD_NAMES,
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 상세로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      // 수정 저장은 상태(퇴원·휴원·재원)를 바꾸며 수강을 닫거나 대기로 돌린다 — 열린 회차 확정 창의 예정 시수.
      if (mode === "edit") notifyTermPlansChanged();
      markSaved(); // dirty 해제 → 저장 후 닫아도 확인 안 뜸
      if (state.notice) alert(state.notice); // 이름 중복으로 접미사(A·B·C) 강제된 경우 안내
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft, mode]);

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
    parent2Name: null,
    parent2Phone: null,
    parent2Relation: null,
    status: "prospect",
    enrolledAt: null,
    withdrawnAt: null,
    notes: null,
  };

  const errors = state?.fieldErrors ?? {};

  // 학년 옵션 = 설정(operations.gradeLevels) 또는 기본. '기타'는 설정과 무관하게 항상 노출(미분류 catch-all).
  // 현재값(v.grade)은 설정 목록에 없어도 합쳐 편집 시 유실 방지.
  const grades = Array.from(
    new Set([
      ...(gradeLevels ?? GRADES),
      ...(v.grade ? [v.grade] : []),
      "기타",
    ]),
  );

  return (
    <form
      action={formAction}
      ref={formRef}
      className="space-y-4"
      onInvalidCapture={(event) => {
        const details = (event.target as HTMLElement).closest("details");
        if (details) details.open = true;
      }}
    >
      <DraftBanner
        savedAt={draft.draftSavedAt}
        onRestore={draft.restore}
        onDiscard={draft.discard}
      />
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}

      <fieldset className="space-y-3 border-t border-line pt-3">
        <legend className="px-1 text-base font-bold">기본 정보</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <Field label="학교" htmlFor="school">
            <input
              id="school"
              name="school"
              defaultValue={v.school ?? ""}
              className={inputClass}
              placeholder="예: 서일고"
            />
          </Field>
          <Field label="학년" htmlFor="grade">
            <select
              id="grade"
              name="grade"
              defaultValue={v.grade ?? ""}
              className={inputClass}
            >
              <option value="">선택</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          {showClassnoteName ? (
            <Field
              label="ClassNote 이름"
              htmlFor="classnoteName"
              hint="동명이인 구분용 — 비우면 학생 이름 사용"
            >
              <input
                id="classnoteName"
                name="classnoteName"
                defaultValue={v.classnoteName ?? ""}
                className={inputClass}
                placeholder="예: 김서윤(중2)"
              />
            </Field>
          ) : (
            <input type="hidden" name="classnoteName" value={v.classnoteName ?? ""} />
          )}
          <Field label="영문 이름" htmlFor="englishName">
            <input
              id="englishName"
              name="englishName"
              defaultValue={v.englishName ?? ""}
              className={inputClass}
              placeholder="예: Minjun Kim"
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
      </fieldset>
      <fieldset className="space-y-3 border-t border-line pt-3">
        <legend className="px-1 text-base font-bold">보호자 연락처</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="학부모 이름" htmlFor="parentName">
            <input
              id="parentName"
              name="parentName"
              defaultValue={v.parentName ?? ""}
              className={inputClass}
              placeholder="예: 김아버지"
            />
          </Field>
          <Field
            label="학부모 연락처"
            htmlFor="parentPhone"
            error={errors.parentPhone}
          >
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
              {GUARDIAN_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          {/* 보호자2(원장 2026-11-04) — 값이 있으면 열린 채로, 없으면 '+ 보호자 추가'. 관계 목록은 보호자1과 같다. */}
          <Guardian2Field
            initial={{ name: v.parent2Name, phone: v.parent2Phone, relation: v.parent2Relation }}
            errors={{ name: errors.parent2Name, phone: errors.parent2Phone, relation: errors.parent2Relation }}
          />
          {mode === "edit" && initialValue?.id && siblings ? (
            // key = 열 때 칩·자동 추천 — 손대지 않은 창이 새로고침돼 새 짝이 오면 칸을 다시 그린다(칩과 '열 때 칩'이 어긋나면
            // 저장이 다른 화면에서 바꾼 짝을 덮는다). 미저장 창은 새로고침되지 않아 고친 칩은 날아가지 않는다.
            <SiblingsField
              key={`${siblings.initial.map((o) => o.value).join(",")}|${siblings.suggested.join(",")}`}
              studentId={initialValue.id}
              initial={siblings.initial}
              review={siblings.review}
              suggested={siblings.suggested}
            />
          ) : null}
        </div>
      </fieldset>
      <fieldset className="space-y-3 border-t border-line pt-3">
        <legend className="px-1 text-base font-bold">등록 상태</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="상태" htmlFor="status">
            {canManageStatus || mode === "create" ? (
            <select
              id="status"
              name="status"
              defaultValue={v.status}
              className={inputClass}
            >
              {/* 🔴 지금 다니는 학생을 이 폼으로 퇴원시키지 않는다 — 퇴원은 퇴원보고서로만(원장 2026-10-23). 퇴원 학생 고치기·새 원생을
                  지난 퇴원 상태로 등록(옛 기록)은 그대로. 서버가 같은 판정으로 다시 거절한다(`formWithdrawalViaReport`). */}
              {Object.entries(STATUS_LABEL).map(([k, label]) => (
                (canManageStatus || !["on_hold", "withdrawn"].includes(k)) && (k !== "withdrawn" || mode === "create" || v.status === "withdrawn") ?
                <option key={k} value={k}>
                  {label}
                </option> : null
              ))}
            </select>
            ) : <p className="py-2 text-sm">{STATUS_LABEL[v.status] ?? v.status}</p>}
          </Field>
          <Field label="등록일" htmlFor="enrolledAt">
            <input
              id="enrolledAt"
              name="enrolledAt"
              type="date"
              defaultValue={v.enrolledAt ?? ""}
              className={inputClass}
            />
          </Field>
          {/* 퇴원일 칸은 새 원생 등록(지난 퇴원 기록)과 이미 퇴원한 학생에게만 — 재원·휴원 학생의 퇴원·퇴원 예약은 퇴원보고서로
              (원장 2026-10-23). 칸을 안 보내면 서버가 저장된 값(걸려 있던 예약 포함)을 그대로 둔다. */}
          {canManageStatus && (mode === "create" || v.status === "withdrawn") ? <Field
            label="퇴원일"
            htmlFor="withdrawnAt"
            error={errors.withdrawnAt}
          >
            <input
              id="withdrawnAt"
              name="withdrawnAt"
              type="date"
              defaultValue={v.withdrawnAt ?? ""}
              className={inputClass}
            />
          </Field> : canManageStatus ? <p className="text-sm text-muted-foreground">퇴원은 원생 화면의 &lsquo;퇴원보고서&rsquo;에서 처리합니다.{v.withdrawnAt ? ` 퇴원 예정일: ${v.withdrawnAt}(예약 취소는 원생 화면에서)` : ""}</p> : <p className="text-sm text-muted-foreground">휴원·복구는 원생 상태 변경 담당자가, 퇴원은 &lsquo;퇴원보고서&rsquo;로 처리합니다.{v.withdrawnAt ? ` 퇴원일: ${v.withdrawnAt}` : ""}</p>}
          {/* 새 퇴원·퇴원 예약이면 사유를 고른다(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*) — 서버와 같은 판정. */}
          <WithdrawalReasonSlot
            formRef={formRef}
            prevStatus={mode === "create" ? null : v.status}
            prevWithdrawnAt={mode === "create" ? null : v.withdrawnAt}
            initialStatus={v.status}
            initialWithdrawnAt={v.withdrawnAt}
            controlClassName={inputClass}
          />
        </div>
      </fieldset>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-bold">
          추가 정보 · 출결번호, 생년월일, 주소 등
        </summary>
        <div className="mt-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="학번" htmlFor="studentCode">
              <input
                id="studentCode"
                name="studentCode"
                defaultValue={v.studentCode ?? ""}
                className={inputClass}
                placeholder="(선택)"
              />
            </Field>
            {/* 출결번호 = 키오스크 체크인 번호 — 키오스크 기능이 꺼진 학원엔 칸이 없다(2026-09-30 "꺼지면 흔적 없이").
                🔴 숨겨도 저장값은 hidden으로 싣는다(칸이 빠지면 서버가 빈 값으로 지운다 — ClassNote 이름과 같은 규약). */}
            {kioskOn ? (
              <Field label="출결번호" htmlFor="attendanceCode" error={errors.attendanceCode}>
                <input
                  id="attendanceCode"
                  name="attendanceCode"
                  inputMode="numeric"
                  defaultValue={v.attendanceCode ?? ""}
                  className={inputClass}
                  placeholder="키오스크 체크인 번호"
                />
              </Field>
            ) : (
              <input type="hidden" name="attendanceCode" value={v.attendanceCode ?? ""} />
            )}
            <Field label="성별" htmlFor="gender">
              <select
                id="gender"
                name="gender"
                defaultValue={v.gender ?? ""}
                className={inputClass}
              >
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
        </div>
      </details>
      <Field
        label={mode === "edit" ? "학생 정보 수정용 특이사항" : "메모 / 특이사항"}
        htmlFor="notes"
        inlineHint={mode === "edit" ? "학생정보 수정용 특이사항만 기록합니다. (수강료 발행 또는 문자발행 등)" : undefined}
      >
        <textarea
          id="notes"
          name="notes"
          aria-describedby={mode === "edit" ? "notes-inline-hint" : undefined}
          defaultValue={v.notes ?? ""}
          rows={4}
          className={`${inputClass} resize-y`}
          placeholder={mode === "edit" ? "학생 정보 수정용 특이사항을 입력하세요" : "자유 메모"}
        />
      </Field>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
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
