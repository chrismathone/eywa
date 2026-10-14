import type { ReactNode } from "react";
import { EmbedLink } from "@/components/embed-link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_H_SM } from "@/components/ui/control-scale";

/**
 * 열 머리 정렬 화살표 — 원장 2026-10-14 *"정렬 학년순이 왜 여깄는지 수정. 각 필터에 오름차순 내림차순이 있어야지"*.
 * 누르면 이 열로 정렬하고, 이미 이 열이면 방향을 뒤집는다. 성적 원장 열 머리(`exams/_components/ledger-head.tsx` SortButton)와
 * 같은 꼴 — 필터가 없는 열(이름)은 열 이름 글자까지 링크라 글자를 눌러도 정렬된다.
 * 화살표 = **누르면 걸릴 방향이 아니라 지금 방향**: 정렬 중이면 진한 ↑(오름차순)·↓(내림차순), 아니면 흐린 ↑(누르면 오름차순).
 * 읽어 주는 이름 = 누르면 일어날 일, 지금 상태는 `<th aria-sort>`가 말한다(화면이 붙인다). 🔴 글자가 있는 링크(이름 열)엔
 * aria-label을 걸지 않는다 — 걸면 열 이름 "이름"을 덮어 낭독기가 칸마다 열 제목을 "이름 오름차순 정렬"로 읽는다. 숨김 글자(sr-only)도
 * 열 제목에 섞이니, 링크의 **설명**(aria-describedby → `hidden` 글자)으로만 붙인다(숨긴 글자는 열 제목 계산에서 빠진다).
 * 높이는 열 머리 컨트롤과 같은 control-scale(폰에서는 이 화살표가 정렬을 바꾸는 유일한 수단이다).
 * 주소는 화면이 만들고, 창 안이면 EmbedLink가 embed를 붙인다([[#133]]).
 */
export function SortArrow({ active, dir, href, label, children, hintId }: {
  active: boolean;
  dir: "asc" | "desc";
  href: string;
  label: string;
  /** 링크 안에 함께 넣을 열 이름(필터가 없는 열). 주면 `hintId`도 준다(문서 안에서 하나뿐인 id). */
  children?: ReactNode;
  hintId?: string;
}) {
  return (
    <EmbedLink
      href={href}
      scroll={false}
      aria-label={children ? undefined : label}
      aria-describedby={children ? hintId : undefined}
      className={`${CONTROL_H_SM} hover:bg-bg-soft inline-flex items-center gap-0.5 rounded-md px-1 ${active ? "text-primary" : "text-text-dim"}`}
    >
      {children}
      {children ? (
        <span id={hintId} hidden>
          {label}
        </span>
      ) : null}
      <EyIcon name={active && dir === "desc" ? "arrowDown" : "arrowUp"} size={14} strokeWidth={active ? 2.6 : 1.6} />
    </EmbedLink>
  );
}
