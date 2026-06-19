"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createInvoice, type CreateInvoiceState } from "@/features/billing/server/actions";
import type { StudentOption } from "@/features/billing/server/textbook-queries";
import { DISCOUNT_CATEGORY, type TuitionCatalogOption } from "@/features/billing/tuition-catalog";
import { koreanHolidaysForRange } from "@/features/billing/holidays-data";
import { countSessions, estimateTuition } from "@/features/billing/tuition-calc";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** "YYYY-MM" → 그 달 말일 "YYYY-MM-DD" (결정적 — 서버/클라 동일). */
function monthLastDay(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, "0")}`;
}

function SaveBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      청구서로 저장
    </Button>
  );
}

export function TuitionCalculator({
  students,
  defaultPeriod,
  holidays = [],
  catalog = [],
}: {
  students: StudentOption[];
  defaultPeriod: string;
  holidays?: string[];
  catalog?: TuitionCatalogOption[];
}) {
  const [startDate, setStartDate] = useState(`${defaultPeriod}-01`);
  const [endDate, setEndDate] = useState(monthLastDay(defaultPeriod));
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]); // 월·수·금 기본
  const [perSession, setPerSession] = useState(30000);
  const [discount, setDiscount] = useState(0);
  const [excludeHolidays, setExcludeHolidays] = useState(true);
  const [courseName, setCourseName] = useState(""); // 단가표에서 고른 과목명(견적·청구서 표시용)

  // 단가표(활성)를 과목 단가 picker / 할인 프리셋 picker로 분리.
  const priceItems = useMemo(() => catalog.filter((c) => c.category !== DISCOUNT_CATEGORY), [catalog]);
  const discountItems = useMemo(() => catalog.filter((c) => c.category === DISCOUNT_CATEGORY), [catalog]);
  const priceOptions = useMemo(
    () =>
      priceItems.map((c) => ({
        value: c.id,
        label: c.note ? `${c.name} ${c.note}` : c.name,
        hint: `${c.category} · ${won(c.price)}`,
      })),
    [priceItems],
  );
  const discountOptions = useMemo(
    () => discountItems.map((c) => ({ value: c.id, label: c.name, hint: `−${won(c.price)}` })),
    [discountItems],
  );

  const pickCourse = (id: string) => {
    const c = priceItems.find((x) => x.id === id);
    if (!c) return;
    setPerSession(c.price);
    setCourseName(c.name);
  };
  const pickDiscount = (id: string) => {
    const c = discountItems.find((x) => x.id === id);
    if (c) setDiscount(c.price);
  };

  const [state, formAction] = useActionState<CreateInvoiceState, FormData>(createInvoice, undefined);

  const est = useMemo(() => {
    // 학원 설정 휴원일은 항상 제외 + 대한민국 공휴일(ijw 이식, 음력·대체 포함)은 토글. 중복은 Set으로 제거.
    const hol = excludeHolidays
      ? Array.from(new Set([...koreanHolidaysForRange(startDate, endDate), ...holidays]))
      : holidays;
    const sessions = countSessions(startDate, endDate, weekdays, hol);
    return estimateTuition({ sessions, perSession, discount });
  }, [startDate, endDate, weekdays, perSession, discount, excludeHolidays, holidays]);

  const period = startDate.slice(0, 7);
  const notes = `${courseName ? `${courseName} · ` : ""}수강료 견적 · ${est.sessions}차시 × ${won(perSession)} (${startDate}~${endDate})`;
  const toggleDay = (d: number) =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 입력 */}
      <div className="bg-card border-line shadow-card space-y-4 rounded-md border p-5">
        <h2 className="text-foreground text-[15px] font-bold">조건 입력</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">시작일</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">종료일</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">수업 요일</span>
          <div className="flex flex-wrap gap-1">
            {DOW.map((label, d) => {
              const on = weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`size-8 rounded-md border text-xs font-medium transition ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-line text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {priceOptions.length > 0 ? (
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">수강료 과목 (단가표)</span>
            <SearchableSelect
              value=""
              onValueChange={pickCourse}
              options={priceOptions}
              placeholder="과목을 고르면 회당 단가가 채워집니다"
              searchPlaceholder="과목명·분류 검색..."
              ariaLabel="수강료 과목 선택"
            />
            {courseName ? <p className="text-primary text-[11px]">선택: {courseName}</p> : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">회당 단가</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={perSession}
              onChange={(e) => {
                setPerSession(Math.max(0, Number(e.target.value)));
                setCourseName("");
              }}
              className={`${inputCls} num text-right`}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">할인</span>
            <input
              type="number"
              min="0"
              step="1000"
              value={discount}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
              className={`${inputCls} num text-right`}
            />
          </label>
        </div>

        {discountOptions.length > 0 ? (
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">할인 프리셋</span>
            <SearchableSelect
              value=""
              onValueChange={pickDiscount}
              options={discountOptions}
              placeholder="할인 항목을 고르면 할인액이 채워집니다"
              searchPlaceholder="할인명 검색..."
              ariaLabel="할인 프리셋 선택"
            />
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={excludeHolidays}
            onChange={(e) => setExcludeHolidays(e.target.checked)}
            className="accent-primary size-4"
          />
          <span className="text-text-dim">대한민국 공휴일 제외 (음력·대체공휴일 포함 · 학원 휴원일은 항상 제외)</span>
        </label>
      </div>

      {/* 견적 + 저장 */}
      <div className="space-y-4">
        <div className="bg-card border-line shadow-card rounded-md border p-5">
          <h2 className="text-foreground text-[15px] font-bold">견적</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="차시" value={`${est.sessions}회`} />
            <Row label="수업료" value={won(est.gross)} />
            <Row label="할인" value={est.discount > 0 ? `-${won(est.discount)}` : "—"} />
            <div className="border-line mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="text-foreground text-sm font-bold">월 수강료</span>
              <span className="text-primary num text-2xl font-extrabold">{won(est.total)}</span>
            </div>
          </dl>
        </div>

        <div className="bg-card border-line shadow-card space-y-3 rounded-md border p-5">
          <h2 className="text-foreground text-[15px] font-bold">청구서로 저장</h2>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="category" value="tuition" />
            <input type="hidden" name="amountTotal" value={est.gross} />
            <input type="hidden" name="amountDiscount" value={est.discount} />
            <input type="hidden" name="notes" value={notes} />
            <div className="space-y-1.5">
              <span className="text-foreground block text-sm font-medium">학생 *</span>
              <SearchableSelect
                name="studentId"
                defaultValue=""
                options={students.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: s.grade ?? undefined,
                }))}
                placeholder="학생 선택..."
                searchPlaceholder="학생 이름 검색..."
              />
            </div>
            <p className="text-text-faint text-[11px]">
              청구월 {period} · {est.sessions}차시 기준. 동일 학생·월 청구서가 있으면 생성되지 않습니다.
            </p>

            {state?.error ? (
              <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
                <AlertCircle className="size-4" />
                {state.error}
              </p>
            ) : state?.ok ? (
              <p className="text-primary inline-flex items-center gap-1.5 text-sm">
                <Check className="size-4" />
                {period} 청구서가 생성되었습니다.
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="size-4" />
                인쇄
              </Button>
              <SaveBtn disabled={est.total <= 0} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-text-dim">{label}</dt>
      <dd className="text-foreground num font-semibold">{value}</dd>
    </div>
  );
}
