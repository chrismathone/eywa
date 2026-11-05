"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

export type MenuMentionEditorProps = {
  name?: string; defaultValue?: string; onChange?: (value: string) => void;
  ariaLabel?: string; placeholder?: string; maxLength?: number; minHeight?: number;
  defaultNames?: boolean;
  /**
   * 읽기 권한 등으로 고칠 수 없는 칸 — 본문을 편집할 수 없게 하고 흐리게 보인다(기본 false = 종전 동작).
   * 🔴 contenteditable이라 바깥 `<fieldset disabled>`로는 잠기지 않는다 — 잠가야 하는 화면은 이 값을 직접 넘길 것(원장 2026-11-05).
   */
  disabled?: boolean;
};

const Impl = dynamic(() => import("./menu-mention-editor-impl").then((m) => m.MenuMentionEditorImpl), {
  ssr: false,
  loading: () => <div className="border-line bg-bg-soft h-36 animate-pulse rounded-lg border" aria-label="내용 편집기 준비 중" />,
});

/** TipTap은 작성할 때만 로드한다. 저장값은 기존 plain text + 안정적인 메뉴 참조다. */
export function MenuMentionEditor(props: MenuMentionEditorProps) {
  const [value, setValue] = useState(props.defaultValue ?? "");
  return <>{props.name ? <input type="hidden" name={props.name} value={value} /> : null}<Impl {...props} name={undefined} onChange={(next) => { setValue(next); props.onChange?.(next); }} /></>;
}
