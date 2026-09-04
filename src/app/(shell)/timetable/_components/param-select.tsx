"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { confirmTimetableNav } from "./timetable-unsaved";

/**
 * 시간표 툴바의 **`축: 값` 드롭다운** — 항목이 값이 아니라 **서버가 만든 href**다(과목·구분·프로그램·뷰).
 *
 * 지시서 §10(원장 2026-09-03 *"남은 결정사항은 지시서 그대로"*): 필터는 칩 줄이 아니라 라벨을 눌러 고른다. 옛 세그먼트
 * 칩 4묶음(과목 N·구분 3·프로그램 3·뷰 4)은 과목 수만큼 늘어나 툴바를 2줄로 밀었고 축 이름(`micro`)이 따로 서 있었다.
 *
 * 왜 `FilterSelect`가 아닌가: 그쪽은 파라미터 하나를 갈아 끼우지만 시간표는 축 하나를 바꿀 때 나머지 축(주·과목별 기본
 * 뷰·1시간 단위·표시 취향·프로그램)을 **함께 실어야** 해서 href를 서버 `buildHref`가 만든다. 이동은 [`ParamLink`](./param-link.tsx)와
 * **같은 규약**: `startTransition` + `router.push(scroll:false)`(스켈레톤 없이 이전 화면 유지) · 이동 전 `confirmTimetableNav()`
 * (그룹 설정 미반영 배치 경고) · 수식키 클릭은 브라우저에 넘긴다(새 탭). 트리거는 `TOOLBAR_SELECT`(control-scale) 그대로.
 *
 * 🔴 **목록은 Portal**(base-ui Popover) — 이 툴바는 1024px 미만·거친 포인터에서 `.toolbar-rail`(overflow-x:auto) 스크롤
 *    컨테이너가 되어 인라인 `absolute` 팝업을 잘라 버린다(globals.css의 rail 주석, 적대적 리뷰 2026-09-04). 같은 줄의
 *    뷰 설정·엑셀·시트 팝오버와 같은 부품이다.
 * ⚠️ 트리거의 접근성 이름은 **보이는 글자 그대로**(`과목: 수학`) — aria-label로 덮으면 보조기기엔 지금 값이 사라진다.
 *    `ariaLabel`은 목록(menu)의 이름이다.
 * ⚠️ 검색 입력은 없다 — 항목이 많아야 예닐곱 개다. 과목이 수십 개가 되면 그때 `SearchableSelect`형으로.
 */
export function ParamSelect({
  axisLabel,
  ariaLabel,
  value,
  options,
}: {
  /** 축 이름 — 트리거에 `축: 값`으로 선다. */
  axisLabel: string;
  /** 펼친 목록의 접근성 이름(예: "과목 선택"). */
  ariaLabel: string;
  value: string;
  options: { value: string; label: string; href: string }[];
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
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // 새 탭 등 보존
                        e.preventDefault();
                        setOpen(false);
                        if (isCurrent) return;
                        if (!confirmTimetableNav()) return;
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
