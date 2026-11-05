"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Popover } from "@base-ui/react/popover";
import { useMobileScrollRow } from "./mobile-scroll-row";
import { useSheetText, useSheetTf } from "@/features/teacher-view/lang-context";

export type ComboOption = {
  value: string;
  label: string;
  /** 이름 뒤에 붙는 부가 정보. `meta`가 함께 있으면 **오른쪽 열**로 서고, 없으면 종전처럼 이름 옆에 붙는다. */
  hint?: string;
  /**
   * 오른쪽 끝 열(상세·분류 등). 🔑 이 값이 있는 줄은 **열 맞춤**으로 그린다 — 이름이 남는 폭을 먹고
   * `hint`(금액 등)는 숫자 정렬로 오른쪽에 선다(원장 2026-09-09 *"목록 열맞춤"* — 교재 단가표 검색에서
   * 금액이 이름 길이를 따라 들쭉날쭉했다). 값이 없는 소비처는 예전 모양 그대로다.
   */
  meta?: string;
  /** 묶음 제목 — 값이 바뀌는 줄 위에 구분선과 제목이 선다(예: 맨 아래 '퇴사자'). 검색으로 걸러도 남은 줄 위에 그대로 선다. */
  group?: string;
};

/**
 * 검색형 콤보박스 — 옵션이 수백 개인 native `<select>`(학생·반 선택 등)를 대체한다.
 * 네이티브 select 팝업은 전역 디자인 스크롤바가 안 닿고(타입어헤드뿐) 수백 옵션이 그대로 벽이 되므로,
 * 타이핑 필터 + 렌더 캡(기본 50) + 디자인 스크롤바가 적용되는 div 팝업으로 컴팩트하게.
 *
 * - 폼 모드: `name`을 주면 hidden input으로 선택값을 제출(필수성은 서버 액션 검증에 위임).
 * - 네비 모드: `value`(제어) + `onValueChange`로 라우팅 등에 사용.
 */
export function SearchableSelect({
  options,
  value,
  defaultValue = "",
  onValueChange,
  name,
  placeholder = "선택...",
  searchPlaceholder = "검색...",
  cap = 50,
  className,
  triggerClassName,
  trailing,
  ariaLabel,
  highlightSelected = false,
  compact = false,
  portal = false,
  defaultOpen,
  onOpenChange,
  valuePrefix,
  prefixOnlyFor,
  sideColumns,
  requireQuery = false,
  multiValues,
  multiSummary,
  disabled = false,
}: {
  options: ComboOption[];
  /** 쓰기 권한이 없을 때 — 목록을 열지 않는다. 안내는 placeholder로(`writeLockedPlaceholder`, src/lib/write-lock.ts). */
  disabled?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  cap?: number;
  className?: string;
  /**
   * 트리거 버튼의 **박스 스타일**만 교체(테두리·높이·padding·글자크기·라운드). 레이아웃(flex·w-full·
   * 화살표 정렬)은 항상 유지된다. ⚠️ 촘촘한 표 안에서는 기본값(py-2·px-3·text-sm)이 옆 입력칸(h-8·px-2·
   * text-xs)보다 눈에 띄게 커서 줄이 들쭉날쭉해진다(원장 2026-07-23 지적) → 그 자리에선 이웃과 같은
   * 클래스를 넘길 것. 미지정이면 기존 기본값 그대로(다른 화면 영향 없음).
   */
  triggerClassName?: string;
  /**
   * 라벨과 쉐브론 **사이**에 서는 꼬리표(예: 반 표기 안의 담임 이름). 트리거 **안**에 두므로 라벨의 `truncate`가
   * 남은 폭에서 실제로 동작한다 — 위에 겹쳐 얹으면 긴 라벨의 끝이 말줄임 없이 덮여 사라진다(2026-09-02 적대적 리뷰).
   */
  trailing?: ReactNode;
  /** 트리거 버튼의 접근성 이름 — 선택값만으론 무엇의 드롭다운인지 불명할 때(필터 등) 서술 라벨 제공. */
  ariaLabel?: string;
  /**
   * 목록에서 **지금 선택된 줄**을 노란 배경 + 굵은 글씨로 강조(원장 2026-08-06, ECS 반 전환).
   * 기본은 꺼둔다 — 옵션이 대여섯 개인 폼 셀렉트에선 체크 아이콘으로 충분하고, 전 드롭다운을 한꺼번에
   * 물들이면 요청받지 않은 화면까지 바뀐다. **길고 자주 갈아타는 목록**(반·학생 전환)에서만 켤 것.
   */
  highlightSelected?: boolean;
  /**
   * 열 맞춤 줄(`meta`가 있는 옵션)의 **오른쪽 두 열 폭·정렬**을 호출부가 정한다 — `hint` 열 · `meta` 열의 클래스.
   * 원장 2026-09-18 *"이름 / 과목 / 날짜 이렇게 열맞춤"*: 기본 모양은 금액(숫자·오른쪽)용이라 `meta`가 48px이고
   * `hint`는 폭이 없어, 과목·날짜 같은 **글자 열**이 들쭉날쭉하거나 잘렸다.
   * 🔑 주면 ① `hint`가 비어도 빈 칸을 세우고 ② 체크 표시 자리를 **늘 비워 둔다** — 안 그러면 선택된 줄만
   *    체크 폭만큼 왼쪽으로 밀려 그 줄의 열이 어긋난다. 안 주면 종전 모양 그대로(다른 화면 영향 없음).
   */
  sideColumns?: { hint: string; meta: string };
  /**
   * 트리거 라벨 앞에 붙는 축 이름("기간" → `기간: 최근 7일`). 목록 안 항목은 그대로다.
   * 툴바에 드롭다운이 여럿 설 때 고른 값만 남으면 어느 축인지 안 읽힌다('완료'가 후속인지 상태인지) —
   * 학생상담 리뷰 확정 결함(2026-09-03). FilterSelect `axisLabel`이 넘긴다.
   */
  valuePrefix?: string;
  /**
   * 이 값이 골라져 있으면 트리거에 **축 이름만** 적는다(`학년` — `학년: 전체`가 아니라). 열 머리 필터(HeaderFilter)가 "안 걸린
   * 축"에 쓴다: 값을 비워 placeholder로 흉내 내면 글자가 옅어지고 목록에 ✓가 안 선다(리뷰 2026-09-03). 값은 진짜로 골라져 있다.
   */
  prefixOnlyFor?: string;
  /**
   * 촘촘한 표 안(높이 24px 안팎)에 놓일 때 — 화살표와 좌우 간격을 줄인다. 기본 화살표(16px)는 24px 박스에서
   * 글자 자리를 먹어 값이 잘린다. ⚠️ 레이아웃 클래스를 **분기해서 한 벌만** 내보낼 것(`gap-2`와 `gap-1`을
   * 같이 적으면 이기는 쪽을 Tailwind가 CSS를 찍은 순서가 정한다 — 아래 톤 분기와 같은 이유).
   */
  compact?: boolean;
  /** 표·스크롤 영역 안에서도 목록이 잘리지 않도록 body에 표시한다. */
  portal?: boolean;
  /**
   * 마운트되자마자 목록을 편 채로 시작 — 더블클릭으로 나타나는 인라인 편집 칸(등록상담 목록뷰)처럼
   * "칸을 열었다 = 고르는 중"인 자리. 평소 폼·필터에선 쓰지 말 것(첫 페인트에 팝오버가 서면 놀란다).
   */
  defaultOpen?: boolean;
  /** 목록이 열리고 닫힐 때(바깥 클릭·Esc·선택 포함) — 인라인 편집 칸이 "고르지 않고 닫았다"를 알아채는 데 쓴다. */
  onOpenChange?: (open: boolean) => void;
  /**
   * 검색어를 치기 전엔 **목록을 안 세운다**(원장 2026-09-23 성적 입력 창 *"처음부터 반을 드랍다운 모두 놓지말고
   * 검색해서 검색결과에 따라 노출"*). 항목이 수십~수백인 자리(반·학생)에서만 켠다 — 기본은 종전처럼 전부 보인다.
   */
  requireQuery?: boolean;
  /**
   * **다중 선택**(원장 2026-09-28 *"이런 류의 드랍다운 선택은 중복 선택가능하게"*) — 지금 골라진 값들. 주면 항목을 눌러도
   * 목록이 **닫히지 않고** `onValueChange(눌린 값)`만 부른다(더하기·빼기는 호출부가 정한다). 비어 있으면 `value`(보통 '전체')에 ✓.
   * 트리거는 고른 이름을 `·`로 잇는다(셋부터 `수학·영어 외 1`). 안 주면 종전 단일 선택 그대로.
   */
  multiValues?: readonly string[];
  /**
   * 다중 선택에서 **둘 이상** 골랐을 때 트리거에 적을 짧은 요약(원장 2026-10-01 영상 제출 현황 *"반 3개"처럼*). 안 주면 `수학 외 1`.
   * 고른 이름 전체는 그대로 트리거 `title`·낭독 이름에 남는다.
   */
  multiSummary?: (count: number) => string;
}) {
  const text = useSheetText();
  const tf = useSheetTf();
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = isControlled ? value : internal;
  const [open, setOpenState] = useState(defaultOpen ?? false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inScrollRow = useMobileScrollRow();
  const portalled = portal || inScrollRow;
  const Trigger = portalled ? Popover.Trigger : "button";
  // 열림 상태는 이 한 곳으로만 바꾼다 — 네 갈래(토글·바깥 클릭·선택·Esc)가 전부 호출부에 알려져야 한다.
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const multi = multiValues !== undefined;
  const picked = multi ? options.filter((o) => multiValues.includes(o.value)) : [];
  const selected: ComboOption | null =
    multi && picked.length > 0
      ? {
          value: picked.map((o) => o.value).join(","),
          // 둘부터 `수학 외 1` — 열 머리(고정 폭 칸)에서 이름을 잇대면 옆 칸으로 넘친다. 전체 목록은 트리거 `title`·낭독 이름에.
          label: picked.length === 1 ? picked[0].label
            : multiSummary ? multiSummary(picked.length) : tf("select.moreSelected", { label: picked[0].label, n: picked.length - 1 }),
        }
      : (options.find((o) => o.value === current) ?? null);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    return options.filter(
      (o) => text(o.label).toLowerCase().includes(t) || o.label.toLowerCase().includes(t) || (o.hint ?? "").toLowerCase().includes(t),
    );
  }, [q, options, text]);
  const waiting = requireQuery && !q.trim();
  // 검색 전엔 '전체' 같은 해제 항목(빈 값)만 남긴다 — 그것까지 숨기면 되돌리려고 '전체'를 타이핑해야 한다.
  const shown = waiting ? options.filter((o) => o.value === "") : filtered.slice(0, cap);
  const overflow = waiting ? 0 : filtered.length - shown.length;

  useEffect(() => {
    if (!open || portalled) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen, portalled]);

  function choose(v: string) {
    if (multi) {
      // 다중 선택 — 여러 개를 고르는 데 여러 번 열 이유가 없다(요일 필터 `closeOnClick={false}`와 같다). 검색어도 남긴다.
      onValueChange?.(v);
      return;
    }
    if (!isControlled) setInternal(v);
    onValueChange?.(v);
    setOpen(false);
    setQ("");
  }

  // 강조는 **고른 게 있을 때만** — 아무것도 안 골랐는데 노랗게 칠하면 placeholder가 선택값처럼 보인다.
  const highlightOn = highlightSelected && selected !== null;
  // ⚠️ 톤은 **분기해서 한 벌만** 내보낸다. `bg-card`와 `bg-amber-soft`를 같이 적으면 어느 쪽이 이길지는
  //    class 문자열 순서가 아니라 Tailwind가 CSS를 찍은 순서가 정해서, 눈으로 못 읽는 버그가 된다.
  const triggerBox =
    triggerClassName ??
    `rounded-md border px-3 py-2 text-sm ${
      highlightOn ? "border-amber/60 bg-amber-soft text-amber" : "border-border bg-card text-foreground"
    }`;

  /**
   * 🔴 `aria-label`은 **버튼 안의 글자를 덮는다** — 축 이름만 주면 화면 낭독기가 "과목 필터"까지만 읽고
   *    지금 고른 값을 영영 안 읽는다(재리뷰 2026-09-04. `HrefSelect`는 처음부터 트리거에 안 달았다).
   *    서술 라벨이 필요한 자리에선 **값을 붙여 한 이름으로** 만든다("과목 필터: 수학").
   */
  const multiFull = multi && picked.length > 1 ? picked.map((o) => text(o.label)).join(", ") : null;
  const a11yValue = multiFull ?? (selected ? text(selected.label) : text(placeholder));
  const a11yName = ariaLabel ? (a11yValue ? `${text(ariaLabel)}: ${a11yValue}` : text(ariaLabel)) : undefined;

  return (
    <SelectFrame portalled={portalled} open={open && !disabled} onOpenChange={disabled ? () => {} : setOpen}>
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <Trigger
        type="button"
        aria-label={a11yName}
        title={multiFull ?? undefined}
        disabled={disabled}
        onClick={portalled || disabled ? undefined : () => setOpen(!open)}
        className={`flex w-full cursor-pointer items-center justify-between disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "gap-1" : "gap-2"} ${triggerBox}`}
      >
        {/* 굵기는 박스 스타일과 안 겹쳐서 triggerClassName을 넘긴 호출부에서도 안전하게 붙는다. */}
        <span
          className={`truncate ${selected ? "" : "text-text-placeholder"} ${highlightOn ? "font-bold" : ""}`}
        >
          {selected
            ? valuePrefix
              ? prefixOnlyFor !== undefined && selected.value === prefixOnlyFor
                ? text(valuePrefix)
                : `${text(valuePrefix)}: ${text(selected.label)}`
              : text(selected.label)
            : text(placeholder)}
        </span>
        {/* 꼬리표는 라벨 뒤·쉐브론 앞, 줄어들지 않는다 — 라벨만 남은 폭에서 접힌다. */}
        {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
        {compact ? (
          <EyIcon name="chevronDown" size={10} className="size-2.5 shrink-0 opacity-60" />
        ) : (
          <EyIcon name="chevronDown" size={16} className="size-4 shrink-0 opacity-50" />
        )}
      </Trigger>
      {/* 비포털 목록도 disabled면 그리지 않는다 — defaultOpen과 함께 와도 고를 수 없게. */}
      {open && !disabled ? (
        <SelectPopup portalled={portalled}>
          <div className="border-border flex items-center gap-2 border-b px-2.5 py-1.5">
            <EyIcon name="search" size={14} className="size-3.5 shrink-0 opacity-50" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter = 첫 결과 선택. preventDefault 필수 — 폼 안에서 쓰이면 Enter가 바깥 폼을
                // 암묵 제출(HTML implicit submission)해 의도치 않은 저장이 발화한다(적대리뷰 2026-07-06).
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (shown.length > 0) choose(shown[0].value);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                  setQ("");
                }
              }}
              placeholder={text(searchPlaceholder)}
              className="text-foreground placeholder:text-text-faint w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {waiting && shown.length > 0 ? <li className="text-text-faint px-3 py-2 text-xs">{text("검색어를 입력하세요")}</li> : null}
            {shown.length === 0 ? (
              <li className="text-text-faint px-3 py-2 text-xs">{text(waiting ? "검색어를 입력하세요" : "결과 없음")}</li>
            ) : (
              shown.map((o, index) => {
                const isCurrent = multi && picked.length > 0 ? multiValues.includes(o.value) : o.value === current;
                // 강조는 **선택된 줄에만** — hover는 그대로 둔다(마우스가 지나간 줄이 선택된 줄처럼 보이면
                // 강조가 무의미해진다). amber-soft/amber는 전역 토큰이라 라이트 팔레트와 어긋나지 않는다.
                const rowTone =
                  highlightSelected && isCurrent
                    ? "bg-amber-soft text-amber font-bold"
                    : "hover:bg-bg-soft";
                return (
                  <Fragment key={o.value}>
                  {o.group && o.group !== shown[index - 1]?.group ? (
                    <li className="border-line text-text-faint mt-1 border-t px-3 pt-2 pb-1 text-xs">{text(o.group)}</li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      aria-pressed={multi ? isCurrent : undefined}
                      onClick={() => choose(o.value)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${rowTone}`}
                    >
                      {o.meta !== undefined && sideColumns ? (
                        // 열 맞춤(폭 지정) — 이름(남는 폭) · hint 열 · meta 열. 빈 hint도 칸을 세운다.
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate" title={text(o.label)}>
                            {text(o.label)}
                          </span>
                          <span className={`text-text-dim shrink-0 truncate text-xs ${sideColumns.hint}`}>
                            {o.hint ?? ""}
                          </span>
                          <span className={`text-text-dim shrink-0 truncate text-xs ${sideColumns.meta}`}>
                            {o.meta}
                          </span>
                        </span>
                      ) : o.meta !== undefined ? (
                        // 열 맞춤 — 이름(남는 폭) · 금액(숫자 정렬, 오른쪽) · 상세(고정 폭).
                        <span className="flex min-w-0 flex-1 items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate">{text(o.label)}</span>
                          {o.hint ? (
                            <span className="num text-text-dim shrink-0 text-right text-xs">{o.hint}</span>
                          ) : null}
                          <span className="text-text-faint w-12 shrink-0 truncate text-right text-xs">{o.meta}</span>
                        </span>
                      ) : (
                        <span className="truncate">
                          {text(o.label)}
                          {o.hint ? <span className="text-text-faint ml-1 text-xs">{o.hint}</span> : null}
                        </span>
                      )}
                      {isCurrent ? (
                        <EyIcon
                          name="check"
                          size={14}
                          className={`size-3.5 shrink-0 ${highlightSelected ? "text-amber" : "text-primary"}`}
                        />
                      ) : sideColumns && o.meta !== undefined ? (
                        // 체크 자리를 비워 둔다 — 선택된 줄만 열이 밀리지 않게.
                        <span aria-hidden className="size-3.5 shrink-0" />
                      ) : null}
                    </button>
                  </li>
                  </Fragment>
                );
              })
            )}
            {overflow > 0 ? (
              <li className="text-text-faint px-3 py-1.5 text-xs">
                {tf("select.moreResults", { n: overflow })}
              </li>
            ) : null}
          </ul>
        </SelectPopup>
      ) : null}
    </div>
    </SelectFrame>
  );
}

function SelectFrame({ portalled, children, open, onOpenChange }: {
  portalled: boolean; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  return portalled ? <Popover.Root open={open} onOpenChange={onOpenChange}>{children}</Popover.Root> : children;
}

function SelectPopup({ portalled, children }: { portalled: boolean; children: ReactNode }) {
  const panel = "border-border bg-card min-w-[12rem] overflow-hidden rounded-md border shadow-lg";
  if (!portalled) return <div className={`${panel} absolute z-50 mt-1 w-full`}>{children}</div>;
  return (
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-50">
        <Popover.Popup className={`${panel} w-(--anchor-width) max-w-(--available-width) outline-none`}>
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
