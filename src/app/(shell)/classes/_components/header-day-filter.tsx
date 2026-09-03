"use client";

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
 */
export function HeaderDayFilter({ value }: { value: string[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const currentParams = useSearchParams();

  const navigate = (days: string[]) => {
    const params = new URLSearchParams(currentParams?.toString() ?? "");
    // 요일순으로 정규화해 같은 집합이 두 URL로 갈리지 않게(저장 비교도 같은 순서).
    const ordered = DAY_FILTERS.map((d) => d.key).filter((k) => days.includes(k));
    params.set("days", ordered.length ? ordered.join(",") : "all");
    params.delete("page"); // 필터 변경은 결과집합이 바뀌므로 1페이지로.
    const s = params.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`);
  };
  const toggle = (key: string) => navigate(value.includes(key) ? value.filter((d) => d !== key) : [...value, key]);

  const summary = DAY_FILTERS.filter((d) => value.includes(d.key))
    .map((d) => d.label)
    .join("·");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="요일 필터"
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
            checked={value.includes(d.key)}
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
