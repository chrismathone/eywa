"use client";

import Link from "next/link";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import type { HubDest } from "@/lib/menu-hub";
import type { teacherNavigationFor } from "@/lib/teacher-navigation";

/** 운영 ‘내 메뉴’와 dev 미리보기가 같은 폴더/메뉴 렌더러를 쓴다. */
export function TeacherNavigationItems({ navigation, onGo }: {
  navigation: ReturnType<typeof teacherNavigationFor>;
  /** dev에서는 화면 이동 대신 선택 결과만 표시한다. */
  onGo?: (destination: HubDest) => void;
}) {
  const item = (d: HubDest) => <DropdownMenuItem key={d.href}
    {...(onGo ? { onClick: () => onGo(d) } : { render: <Link href={d.href} className="cursor-pointer" /> })}>
    <MenuGlyph name={d.icon} size={16} /><span className="min-w-0 break-words">{d.label}</span>
  </DropdownMenuItem>;
  return <>
    {navigation.home ? item(navigation.home) : null}
    {navigation.home && navigation.grouped && navigation.groups.length ? <DropdownMenuSeparator /> : null}
    {navigation.grouped ? navigation.groups.map((g) => <DropdownMenuSub key={g.id}>
      <DropdownMenuSubTrigger><MenuGlyph name={g.icon} size={16} /><span className="min-w-0 break-words">{g.label}</span></DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64 max-w-[calc(100vw-2rem)]">{g.items.map(item)}</DropdownMenuSubContent>
    </DropdownMenuSub>) : navigation.groups.flatMap((g) => g.items).map(item)}
  </>;
}
