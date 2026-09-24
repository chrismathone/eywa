"use client";

import { useState } from "react";

/**
 * 진도 칸을 **차시 단위로** 나눈다(`2-2-1 …`·`2-3-6 …`처럼 단원 번호가 이어 붙은 긴 진도). 번호가 둘 이상일 때만 나누고,
 * 번호 앞 글(과목 머리 `수학`)은 첫 줄에 붙여 둔다. 일반 문장(`일차방정식의 활용(수)`)은 그대로 한 줄.
 */
export function splitProgressItems(text: string): string[] {
  const parts = text.split(/\s+(?=\d+-\d+(?:-\d+)*\s)/).map((p) => p.trim()).filter(Boolean);
  // 번호 앞 머리(`수학`)는 따로 한 줄을 차지하지 않게 첫 차시에 붙인다.
  if (parts.length > 1 && !/^\d+-\d+/.test(parts[0]!)) parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  return parts.length > 1 ? parts : [text];
}

/**
 * 원생 상세 '진도' 칸(원장 2026-09-24 *"너무 긴 진도(2줄 이상)는 생략하고 마우스오버하면 다 보이게 · 혹은 클릭하면 전체"*).
 * 평소엔 **두 줄까지**만(넘치면 말줄임) — 마우스를 올리면 전체(차시마다 한 줄), 누르면 칸 안에서 차시별로 펼친다.
 * 같은 글자를 펼치는 것이라 `title`을 쓴다(메모 카드 규약 대상 아님).
 */
export function ProgressCell({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const items = splitProgressItems(text);
  const long = items.length > 1 || text.length > 60;
  if (!long) return <span>{text}</span>;
  return <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? "눌러서 접기" : items.join("\n")}
    className="hover:text-primary block w-full cursor-pointer text-left">
    {open ? <ul className="space-y-0.5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
      : <span className="line-clamp-2">{text}</span>}
  </button>;
}
