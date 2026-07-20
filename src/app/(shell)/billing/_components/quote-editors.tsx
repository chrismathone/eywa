"use client";

import { Trash2 } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Pill } from "@/components/atoms/pill";
import type { QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";
import type { TuitionCatalogOption } from "@/features/billing/tuition-catalog";

const KRW = new Intl.NumberFormat("ko-KR");
const input =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
const num = (v: string) => Math.max(0, Number(v.replace(/[,\s]/g, "")) || 0);

/** 단가표(활성)에서 항목을 골라 추가 — value=""로 리셋되는 picker. */
export function CatalogPicker({
  options,
  placeholder,
  onPick,
}: {
  options: TuitionCatalogOption[];
  placeholder: string;
  onPick: (o: TuitionCatalogOption) => void;
}) {
  return (
    <SearchableSelect
      value=""
      onValueChange={(id) => {
        const o = options.find((x) => x.id === id);
        if (o) onPick(o);
      }}
      options={options.map((o) => ({
        value: o.id,
        label: o.note ? `${o.name} ${o.note}` : o.name,
        hint: `${o.category} · ${KRW.format(o.price)}원`,
      }))}
      placeholder={placeholder}
      searchPlaceholder="검색..."
      ariaLabel={placeholder}
    />
  );
}

const chip = (on: boolean) =>
  `shrink-0 rounded-full border px-2 py-0.5 text-[11px] transition ${
    on ? "border-primary bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft"
  }`;

export function CourseEditor({
  course,
  onPatch,
  onRemove,
}: {
  course: QuoteCourse;
  onPatch: (patch: Partial<QuoteCourse>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border-line bg-card space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Pill color="neutral" soft>
          {course.category}
        </Pill>
        <input
          className={`${input} flex-1`}
          value={course.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="반 이름"
        />
        <button type="button" onClick={onRemove} className="text-text-dim hover:text-danger shrink-0" aria-label="과목 삭제">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-[1.4fr_0.8fr_1fr] gap-2">
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">요일</span>
          <input
            className={input}
            value={course.days}
            onChange={(e) => onPatch({ days: e.target.value })}
            placeholder="월,수,금"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">{course.fixedMonthly ? "월 N회" : "시수"}</span>
          <input
            type="number"
            min="0"
            className={`${input} num text-right`}
            value={course.sessions}
            onChange={(e) => onPatch({ sessions: num(e.target.value) })}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">금액</span>
          <input
            type="number"
            min="0"
            step="1000"
            className={`${input} num text-right`}
            value={course.price}
            onChange={(e) => onPatch({ price: num(e.target.value) })}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className={`${input} flex-1`}
          value={course.note}
          onChange={(e) => onPatch({ note: e.target.value })}
          placeholder="비고 (예: 내신대비 보강)"
        />
        <button type="button" className={chip(course.excludeHolidays)} onClick={() => onPatch({ excludeHolidays: !course.excludeHolidays })}>
          공휴일 제외
        </button>
        <button type="button" className={chip(course.fixedMonthly)} onClick={() => onPatch({ fixedMonthly: !course.fixedMonthly })}>
          월 N회 고정
        </button>
      </div>
    </div>
  );
}

export function ExtraEditor({
  extra,
  onPatch,
  onRemove,
}: {
  extra: QuoteExtra;
  onPatch: (patch: Partial<QuoteExtra>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border-line bg-card flex items-end gap-2 rounded-md border p-2.5">
      <label className="flex-1 space-y-0.5">
        <span className="text-text-faint text-[11px]">항목명 (교재·기타)</span>
        <input className={input} value={extra.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="예: 교재비, 입학금, 모의고사비" />
      </label>
      <label className="w-28 shrink-0 space-y-0.5">
        <span className="text-text-faint text-[11px]">금액</span>
        <input
          type="number"
          min="0"
          step="1000"
          className={`${input} num text-right`}
          value={extra.price}
          onChange={(e) => onPatch({ price: num(e.target.value) })}
        />
      </label>
      <button type="button" onClick={onRemove} className="text-text-dim hover:text-danger mb-1.5 shrink-0" aria-label="항목 삭제">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

export function DiscountEditor({
  discount,
  onPatch,
  onRemove,
}: {
  discount: QuoteDiscount;
  onPatch: (patch: Partial<QuoteDiscount>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border-line bg-card flex items-end gap-2 rounded-md border p-2.5">
      <label className="flex-1 space-y-0.5">
        <span className="text-text-faint text-[11px]">할인명</span>
        <input className={input} value={discount.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="예: 형제 할인, 조기등록" />
      </label>
      <label className="w-28 shrink-0 space-y-0.5">
        <span className="text-text-faint text-[11px]">할인액</span>
        <div className="relative">
          <span className="text-text-faint pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm">−</span>
          <input
            type="number"
            min="0"
            step="1000"
            className={`${input} num pl-5 text-right`}
            value={discount.amount}
            onChange={(e) => onPatch({ amount: num(e.target.value) })}
          />
        </div>
      </label>
      <button type="button" onClick={onRemove} className="text-text-dim hover:text-danger mb-1.5 shrink-0" aria-label="할인 삭제">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
