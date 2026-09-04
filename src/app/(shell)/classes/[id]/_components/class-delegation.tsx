"use client";

/**
 * 반 임시 위임(결근 대체 수업, 0173a) — 인수인계 옆자리.
 *
 * 인수인계와 **의도적으로 다르게** 보여야 한다: 인수인계는 담임이 바뀌는 영구 변경이고, 위임은
 * "이 기간만 대신 맡기"다. 같은 모양으로 두면 결근 하루에 담임을 갈아버리는 사고가 난다
 * (담임을 바꾸면 시간표·급여 분배·ECS 스코프가 따라 움직이고 되돌리기 어렵다).
 * → 위임은 앰버 톤 + 기간이 항상 보이는 배너로, 인수인계는 기존 프라이머리 톤 그대로.
 */

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, CalendarClock, Check, Loader2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createClassDelegation,
  revokeClassDelegation,
  type DelegationState,
} from "@/features/classes/server/actions";
import {
  DELEGATION_MAX_DAYS,
  delegationRangeLabel,
  validateDelegationRange,
} from "@/features/classes/delegation-window";
// 강사뷰 화면 언어 — provider는 강사 미니셸·창에만 있어 관리자 풀셸은 한국어로 떨어진다.
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

const inputCls =
  "border-border bg-background text-foreground placeholder:text-muted-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

type TeacherOption = { id: string; name: string; hint?: string };

export type ActiveDelegation = {
  id: string;
  delegateName: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
};

function SaveBtn({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  const t = useSheetT();
  // 기간이 잘못됐으면 아예 못 누르게 — 서버도 같은 함수로 거절하지만, 왕복해서 같은 말을 듣게 할 이유가 없다.
  return (
    <Button type="submit" size="sm" disabled={pending || blocked}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      {t("cls.dg.submit")}
    </Button>
  );
}

function DelegateDialog({
  classId,
  className,
  currentTeacherName,
  teacherOptions,
  onClose,
}: {
  classId: string;
  className: string;
  currentTeacherName: string | null;
  teacherOptions: TeacherOption[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<DelegationState, FormData>(createClassDelegation, undefined);
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const today = kstToday();
  // 기본은 **하루**(오늘) — 결근 대체의 압도적 다수가 하루다. 여러 날이면 종료일만 늘린다.
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  // 서버와 **같은 순수함수**로 미리 알린다(두 벌로 적으면 화면과 서버가 다른 말을 한다).
  const rangeError = validateDelegationRange(fromDate, toDate, lang);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      {/* ⚠️ overflow-y-auto/max-h 금지 — SearchableSelect 팝업(absolute)이 잘린다(인수인계 다이얼로그와 동일). */}
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-foreground text-lg font-bold">{t("cls.dg.dialogTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("cls.ho.close")}
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="classId" value={classId} />
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-medium">{className}</span>
            {t("cls.dg.introA")}
            <span className="text-foreground">{currentTeacherName ?? t("cls.ho.teacherNone")}</span>
            {t("cls.dg.introB")}
            <span className="text-foreground font-medium">{t("cls.dg.introC")}</span>
            {t("cls.dg.introD")}
          </p>

          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">{t("cls.dg.delegate")}</span>
            <SearchableSelect
              name="delegateUserId"
              options={teacherOptions.map((t) => ({ value: t.id, label: t.name, hint: t.hint }))}
              placeholder={t("cls.dg.pickTeacher")}
              searchPlaceholder={t("cls.ho.searchName")}
              ariaLabel={t("cls.dg.delegateAria")}
            />
            <p className="text-text-faint text-xs">
              {t("cls.dg.hintA")}
              <span className="text-amber font-bold">{t("cls.dg.hintB")}</span>
              {t("cls.dg.hintC")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1.5">
              <span className="text-foreground block text-sm font-medium">{t("cls.dg.fromDate")}</span>
              <input
                name="fromDate"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  // 시작일을 종료일 뒤로 밀면 종료일도 같이 민다 — 사람이 고쳐야 할 오류를 만들지 않는다.
                  if (e.target.value > toDate) setToDate(e.target.value);
                }}
                className={`${inputCls} num`}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-foreground block text-sm font-medium">{t("cls.dg.toDate")}</span>
              <input
                name="toDate"
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
                className={`${inputCls} num`}
              />
            </label>
          </div>
          <p className="text-text-faint text-xs">
            {tf("cls.dg.maxHintA", { n: DELEGATION_MAX_DAYS })}
            <span className="text-foreground">{t("cls.dg.maxHintB")}</span>
            {t("cls.dg.maxHintC")}
          </p>

          <label className="block space-y-1.5">
            <span className="text-foreground block text-sm font-medium">{t("cls.ho.reason")}</span>
            <textarea name="reason" rows={2} className={`${inputCls} resize-y`} placeholder={t("cls.ho.optional")} />
          </label>

          {rangeError || state?.error ? (
            <p className="text-danger inline-flex items-start gap-1.5 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {rangeError ?? state?.error}
            </p>
          ) : null}

          <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cls.ho.cancel")}
            </Button>
            <SaveBtn blocked={rangeError != null} />
          </div>
        </form>
      </div>
    </div>
  );
}

/** 위임 걸기 트리거 — 반 상세 헤더(인수인계 옆). */
export function DelegateAction({
  classId,
  className,
  currentTeacherName,
  teacherOptions,
}: {
  classId: string;
  className: string;
  currentTeacherName: string | null;
  teacherOptions: TeacherOption[];
}) {
  const [open, setOpen] = useState(false);
  const t = useSheetT();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock className="size-4" />
        {t("cls.dg.open")}
      </Button>
      {open ? (
        <DelegateDialog
          classId={classId}
          className={className}
          currentTeacherName={currentTeacherName}
          teacherOptions={teacherOptions}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RevokeBtn() {
  const { pending } = useFormStatus();
  const t = useSheetT();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : null}
      {t("cls.dg.revoke")}
    </button>
  );
}

/**
 * 걸려 있는 위임 배너 — 지난 위임도 기간이 끝날 때까지는 남는다(해제는 사람이 명시로).
 * `todayYmd`는 서버에서 내린 KST 오늘 — 클라 시계로 판정하면 기기 시간대에 따라 '진행 중'이 어긋난다.
 */
export function DelegationBanner({
  rows,
  todayYmd,
  canRevoke,
}: {
  rows: ActiveDelegation[];
  todayYmd: string;
  canRevoke: boolean;
}) {
  // 🔴 상태를 버리면(`const [, action]`) 해제 실패가 **아무 표시 없이** 사라진다 — 권한이 없거나 경합으로
  //    거절돼도 화면은 그대로라 "눌렀는데 아무 일도 안 일어남"이 된다(gotcha #67 계열). 반드시 보여준다.
  const [state, revokeAction] = useActionState<DelegationState, FormData>(revokeClassDelegation, undefined);
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  if (rows.length === 0) return null;
  return (
    <div className="border-amber/30 bg-amber-soft/50 space-y-2 rounded-lg border px-4 py-3">
      <p className="text-amber inline-flex items-center gap-1.5 text-[13px] font-bold">
        <CalendarClock className="size-4" />
        {tf("cls.dg.bannerTitle", { n: rows.length })}
      </p>
      {state?.error ? (
        <p className="text-danger inline-flex items-start gap-1.5 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const active = r.fromDate <= todayYmd && todayYmd <= r.toDate;
          const upcoming = r.fromDate > todayYmd;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-bold">{r.delegateName ?? t("cls.dg.nameNone")}</span>
                <span className="text-text-dim num text-xs">
                  {delegationRangeLabel(r.fromDate, r.toDate, lang)}
                </span>
                {/* 상태는 사전에서 — 화면에 영문 키(raw enum)를 내보내지 않는다. */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? "bg-amber text-white" : "border-border text-text-dim border"
                  }`}
                >
                  {t(active ? "cls.dg.active" : upcoming ? "cls.dg.upcoming" : "cls.dg.ended")}
                </span>
                {r.reason ? <span className="text-text-dim text-xs">{r.reason}</span> : null}
              </span>
              {canRevoke ? (
                <form action={revokeAction}>
                  <input type="hidden" name="delegationId" value={r.id} />
                  <RevokeBtn />
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
