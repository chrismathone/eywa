"use client";

import { Trash2 } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  FEE_KIND_LABEL,
  feeKindOf,
  formatDays,
  needsFeeKindCheck,
} from "@/features/billing/quote-calc";
import { Pill } from "@/components/atoms/pill";
import type { QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";
import type { TuitionCatalogOption } from "@/features/billing/tuition-catalog";

const KRW = new Intl.NumberFormat("ko-KR");
const input =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
const num = (v: string) => Math.max(0, Number(v.replace(/[,\s]/g, "")) || 0);
/**
 * 숫자 칸 표시값 — **0이면 빈 칸**(원장 2026-08-07: *"시수를 전부 지우면 0이 되는데 12를 적으면 012가 됨"*).
 *
 * 🔴 뿌리는 "지웠는데 0이 남는 것"이다. 칸을 비우면 `0`이 박혀 있고, 거기에 이어 쓰면 `012`가 된다
 *    (값은 12로 읽히지만 눈에는 012라 사람이 자기 입력을 못 믿는다). 빈 칸을 빈 칸으로 두면 그 일이 없다.
 * ⚠️ 여기서 0과 미입력은 **같은 뜻**이다(시수 0 = 아직 안 정함, 금액 0 = 아직 안 적음) — 둘을 가를
 *    필요가 없으므로 표시만 비운다. 저장값은 그대로 0.
 */
const numValue = (n: number) => (n ? String(n) : "");

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
      {/* 🔴 **수강료 구분**을 맨 위에 명시한다(원장 2026-08-07: *"EiE 수업이 전부 27만원으로 잡혀있는데
          까딱하다가 1회당 27만원으로 계산되기 때문"*). 예전엔 맨 아래 '월 N회 고정' 칩 하나가 전부여서,
          이게 월 금액인지 회당 단가인지 **화면 어디에도 안 적혀 있었다**. 금액을 읽기 전에 먼저 보이게 둔다. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-text-faint text-[11px]">수강료 구분</span>
        <div className="flex gap-1" role="group" aria-label={`${course.name || "과목"} 수강료 구분`}>
          {(["monthly", "per_session"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={feeKindOf(course) === k}
              onClick={() => onPatch({ fixedMonthly: k === "monthly" })}
              className={chip(feeKindOf(course) === k)}
            >
              {FEE_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <span className="text-text-faint text-[11px]">
          {course.fixedMonthly ? "· 금액을 그대로 청구(월 정액)" : "· 회당 단가 × 시수"}
        </span>
      </div>
      {/* 단가표에서 가져왔는데 그 항목에 종류가 안 적혀 있던 경우 — 안전하게 '월 고정'으로 넣되 **말은
          해 준다**. 침묵하면 회당 단가가 월 금액으로(또는 그 반대로) 조용히 굳는다.
          ⚠️ **옛 견적(출처 기록 없음)에는 안 뜬다** — 모르는 것을 "없다"고 말하면 안 된다(needsFeeKindCheck). */}
      {needsFeeKindCheck(course) ? (
        <p className="border-amber/40 bg-amber-soft text-amber rounded-md border px-2 py-1 text-[11px] leading-snug">
          이 항목은 단가표에 <b>단가 종류</b>가 정해져 있지 않아 <b>월 고정</b>으로 넣었습니다 — 회당
          수업이면 위에서 바꿔 주세요. (단가표에서 종류를 채워 두면 다음부터 자동으로 잡힙니다.)
        </p>
      ) : null}
      <div className={`grid gap-2 ${course.fixedMonthly ? "grid-cols-[1.4fr_0.8fr_1fr]" : "grid-cols-[1.2fr_0.9fr_0.7fr_1fr]"}`}>
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">요일</span>
          <input
            className={input}
            value={course.days}
            onChange={(e) => onPatch({ days: e.target.value })}
            // 칸을 벗어날 때 "월수목" → "월,수,목"으로 정리한다(원장 2026-08-07).
            // ⚠️ 읽은 요일이 하나도 없으면(오타) **그대로 둔다** — 지워 버리면 뭘 쳤는지 잃는다.
            onBlur={(e) => {
              const tidy = formatDays(e.target.value);
              if (tidy && tidy !== e.target.value) onPatch({ days: tidy });
            }}
            placeholder="월,수,금 (월수금처럼 붙여 써도 됩니다)"
          />
        </label>
        {/* 회당 단가 — **회당일 때만**. 🔴 예전엔 이 칸이 화면에 없어서, 단가표에 종류가 없는 항목(회당 단가가
            0으로 들어온다)을 '회당'으로 바꾸면 금액이 **0원으로 죽고 되살릴 방법이 없었다**(요일·시수를 고칠
            때마다 0×시수로 다시 덮였다). 구분을 고를 수 있게 만든 이상, 그 구분에 필요한 값도 고칠 수 있어야 한다. */}
        {!course.fixedMonthly ? (
          <label className="space-y-0.5">
            <span className="text-text-faint text-[11px]">회당 단가</span>
            <input
              type="number"
              min="0"
              step="1000"
              className={`${input} num text-right`}
              value={numValue(course.perSession)}
            placeholder="0"
              onChange={(e) => onPatch({ perSession: num(e.target.value) })}
            />
          </label>
        ) : null}
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">{course.fixedMonthly ? "월 N회" : "시수"}</span>
          <input
            type="number"
            min="0"
            className={`${input} num text-right`}
            value={numValue(course.sessions)}
            placeholder="0"
            onChange={(e) => onPatch({ sessions: num(e.target.value) })}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-text-faint text-[11px]">{course.fixedMonthly ? "월 금액" : "총 금액"}</span>
          <input
            type="number"
            min="0"
            step="1000"
            className={`${input} num text-right`}
            value={numValue(course.price)}
            placeholder="0"
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
          value={numValue(extra.price)}
            placeholder="0"
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
            value={numValue(discount.amount)}
            placeholder="0"
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
