"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";

/**
 * **`축: 값` 드롭다운 — 항목이 값이 아니라 href**(서버가 만든 주소로 이동한다).
 *
 * 지시서 §10(원장 2026-09-03 *"남은 결정사항은 지시서 그대로"*): 필터는 칩 줄이 아니라 라벨을 눌러 고른다.
 * [`FilterSelect`](./filter-select.tsx)는 파라미터 하나를 갈아 끼우지만, 축 하나를 바꿀 때 **나머지 축을 함께 실어야**
 * 하는 화면(시간표 `buildHref`, 출석부 `attHref`)은 주소를 서버가 만든다 — 그럴 때 이 부품이다.
 *
 * 이동 규약 = 시간표 `ParamLink`와 같다: `startTransition` + `router.push(scroll:false)`(스켈레톤 없이 이전 화면 유지) ·
 * 수식키 클릭(새 탭)은 브라우저에 넘긴다 · 지금 값을 다시 고르면 닫기만 한다 · `beforeNavigate`가 false를 주면 이동하지 않는다
 * (시간표의 미저장 배치 경고 — 클라 래퍼가 넘긴다; 서버 컴포넌트는 함수를 못 넘기니 그 화면의 얇은 클라 래퍼가 든다).
 *
 * 🔴 **목록은 Portal**(base-ui Popover) — 툴바는 1024px 미만·거친 포인터에서 `.toolbar-rail`(overflow) 스크롤 컨테이너가 되어
 *    인라인 `absolute` 팝업을 잘라 버린다(globals.css의 rail 주석, 적대적 리뷰 2026-09-04).
 * ⚠️ 트리거의 접근성 이름은 **보이는 글자 그대로**(`과목: 수학`) — aria-label로 덮으면 보조기기엔 지금 값이 사라진다.
 *    `ariaLabel`은 펼친 목록(menu)의 이름이다.
 * ⚠️ 검색 입력은 없다 — 항목이 많아야 예닐곱 개인 축에 쓴다(수십 개면 `FilterSelect`/`SearchableSelect`).
 */
export type HrefSelectOption = { value: string; label: string; href: string };

export function HrefSelect({
  axisLabel,
  ariaLabel,
  value,
  options,
  beforeNavigate,
}: {
  /** 축 이름 — 트리거에 `축: 값`으로 선다. */
  axisLabel: string;
  /** 펼친 목록의 접근성 이름(예: "과목 선택"). */
  ariaLabel: string;
  value: string;
  options: HrefSelectOption[];
  /** 이동 직전 확인(false = 취소). 클라 컴포넌트만 넘길 수 있다. */
  beforeNavigate?: () => boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-busy={pending || undefined}
        className={`${TOOLBAR_SELECT} shrink-0 cursor-pointer gap-2 data-[popup-open]:bg-bg-soft ${pending ? "animate-pulse opacity-60" : ""}`}
      >
        <span className="truncate">
          {axisLabel}: {selected?.label ?? "—"}
        </span>
        <EyIcon name="chevronDown" size={16} className="size-4 shrink-0 opacity-50" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="border-border bg-card min-w-[10rem] overflow-hidden rounded-md border py-1 shadow-lg outline-none">
            <ul role="menu" aria-label={ariaLabel}>
              {options.map((o) => {
                const isCurrent = o.value === value;
                return (
                  <li key={o.value} role="none">
                    <a
                      role="menuitem"
                      href={o.href}
                      aria-current={isCurrent ? "true" : undefined}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm whitespace-nowrap ${
                        isCurrent ? "text-foreground font-bold" : "text-text-dim hover:bg-bg-soft hover:text-foreground"
                      }`}
                      onClick={(e) => {
                        // 목록은 어떤 클릭에도 닫힌다 — 수식키 클릭(새 탭)은 브라우저에 넘기되 팝업만 열린 채 남지 않게(리뷰 2026-09-04).
                        setOpen(false);
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // 새 탭 등 보존
                        e.preventDefault();
                        if (isCurrent) return;
                        if (beforeNavigate && !beforeNavigate()) return;
                        start(() => router.push(o.href, { scroll: false }));
                      }}
                    >
                      <span className="truncate">{o.label}</span>
                      {isCurrent ? <EyIcon name="check" size={14} className="text-primary size-3.5 shrink-0" /> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
