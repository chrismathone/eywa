"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { HEADER_FILTER_TRIGGER } from "@/components/header-filter";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DAY_FILTERS } from "@/features/classes/list-filters";

/**
 * 수업목록 **요일 열 머리 필터** — 다중 선택(월·수 = 둘 중 하나라도 운영하는 반, ijw 의미 그대로). 단일 선택인
 * `HeaderFilter`(FilterSelect)로는 못 담아 체크 항목 메뉴로 따로 섰다 — 트리거 치수·글자는 같은 `HEADER_FILTER_TRIGGER`라
 * 옆 열 머리와 한 줄에 선다.
 *
 * URL은 `days=mon,wed`. 🔴 **"전체"도 `days=all`로 적는다**(학생목록 `explicitAll`과 같은 이유) — 서버가 "파라미터 없음 =
 * 계정에 저장된 보기 설정"으로 읽어서, 지우면 저장된 요일이 되살아나 전체를 고를 길이 없다. `all`은 요일 키가 아니라 파서가
 * 빈 배열로 접는다(`parseClassDays`).
 * 항목을 눌러도 메뉴는 닫히지 않는다(`closeOnClick={false}`) — 두 요일을 고르는 데 두 번 열 이유가 없다.
 * 🔴 그래서 **낙관적 선택**이 필요하다: 서버 왕복(수백 ms) 안에 둘째 항목을 누르는데, 서버가 준 `value`로 다음 집합을 만들면 첫 클릭이
 *    사라진다(적대적 리뷰 2026-09-04: 월 → 수 연타가 `days=wed`로 끝났다). 전환이 도는 동안은 마지막으로 보낸 집합이 화면이고, 끝나면 서버 값.
 */
export function HeaderDayFilter({ value }: { value: string[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<string[]>(value);
  const effective = pending ? local : value;

  const navigate = (days: string[]) => {
    const params = new URLSearchParams(currentParams?.toString() ?? "");
    // 요일순으로 정규화해 같은 집합이 두 URL로 갈리지 않게(저장 비교도 같은 순서).
    const ordered = DAY_FILTERS.map((d) => d.key).filter((k) => days.includes(k));
    params.set("days", ordered.length ? ordered.join(",") : "all");
    params.delete("page"); // 필터 변경은 결과집합이 바뀌므로 1페이지로.
    const s = params.toString();
    setLocal(ordered);
    startTransition(() => router.push(`${pathname}${s ? `?${s}` : ""}`));
  };
  const toggle = (key: string) =>
    navigate(effective.includes(key) ? effective.filter((d) => d !== key) : [...effective, key]);

  const summary = DAY_FILTERS.filter((d) => effective.includes(d.key))
    .map((d) => d.label)
    .join("·");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            // 🔴 aria-label은 버튼 글자를 덮는다 — 고른 요일을 함께 실어야 낭독기가 지금 값을 읽는다(재리뷰 2026-09-04).
            aria-label={summary ? `요일 필터: ${summary}` : "요일 필터"}
            className={`${HEADER_FILTER_TRIGGER} inline-flex items-center gap-1 align-middle`}
          />
        }
      >
        {/* 안 걸렸으면 축 이름만(`요일`), 걸리면 `요일: 월·수` — HeaderFilter의 prefixOnlyFor 규약과 같은 모양. */}
        {summary ? `요일: ${summary}` : "요일"}
        <EyIcon name="chevronDown" size={14} className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-36">
        <DropdownMenuItem onClick={() => navigate([])} className="font-medium">
          전체
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {DAY_FILTERS.map((d) => (
          <DropdownMenuCheckboxItem
            key={d.key}
            checked={effective.includes(d.key)}
            closeOnClick={false}
            onCheckedChange={() => toggle(d.key)}
          >
            {d.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
