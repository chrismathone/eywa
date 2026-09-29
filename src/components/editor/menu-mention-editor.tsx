"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

export type MenuMentionEditorProps = {
  name?: string; defaultValue?: string; onChange?: (value: string) => void;
  ariaLabel?: string; placeholder?: string; maxLength?: number; minHeight?: number;
  defaultNames?: boolean;
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
