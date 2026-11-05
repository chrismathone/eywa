"use client";

import { useEffect, useId, useState } from "react";
import { EditorContent, useEditor, Node, ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Plugin } from "@tiptap/pm/state";
import { Slice, type Node as DocNode } from "@tiptap/pm/model";
import { MENU_MENTION_CATALOG, menuMentionDestination, menuMentionToken, parseMenuMentions } from "@/features/owner/menu-mentions";
import { useMenuPresentation } from "@/features/owner/navigation-context";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { MenuMentionEditorProps } from "./menu-mention-editor";

function documentOf(text: string, labelOf: (href: string) => string): JSONContent {
  return { type: "doc", content: text.split(/\r?\n/).map((line) => ({ type: "paragraph", content: parseMenuMentions(line).flatMap((part): JSONContent[] => {
    if (part.type === "text") return part.text ? [{ type: "text", text: part.text }] : [];
    return menuMentionDestination(part.href) ? [{ type: "menuMention", attrs: { href: part.href, label: labelOf(part.href) } }]
      : [{ type: "text", text: `@[${part.label}](menu:${part.href})` }];
  }) })) };
}

function serialize(doc: DocNode): string {
  const blocks: string[] = [];
  doc.forEach((block) => {
    let text = "";
    block.descendants((node) => {
      if (node.isText) text += node.text ?? "";
      if (node.type.name === "hardBreak") text += "\n";
      if (node.type.name === "menuMention") text += menuMentionToken(String(node.attrs.href));
    });
    blocks.push(text);
  });
  return blocks.join("\n");
}

type Suggestion = { from: number; to: number; query: string };
function MentionChip({ node, extension }: NodeViewProps) {
  const present = useMenuPresentation();
  const original = menuMentionDestination(String(node.attrs.href));
  const d = extension.options.defaultNames ? original : present(String(node.attrs.href)) ?? original;
  return <NodeViewWrapper as="span" contentEditable={false} data-menu-href={node.attrs.href} className="bg-primary-soft text-primary inline-block max-w-full rounded px-1 py-0.5 align-baseline font-semibold break-words">@{d?.label ?? "메뉴"}</NodeViewWrapper>;
}

function suggestionAt(editor: Editor): Suggestion | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "", "\ufffc");
  // 이메일 중간의 @는 후보를 열지 않는다. 공백/문장부호 뒤에서만 메뉴 참조를 시작한다.
  const match = /(?:^|[\s([{])@([^@\n\ufffc]{0,40})$/.exec(text);
  return match ? { from: selection.from - match[1].length - 1, to: selection.from, query: match[1] } : null;
}

export function MenuMentionEditorImpl({ name, defaultValue = "", onChange, ariaLabel = "내용", placeholder = "내용을 입력하세요. @를 입력하면 메뉴를 선택할 수 있습니다.", maxLength = 8000, minHeight = 160, defaultNames = false, disabled = false }: MenuMentionEditorProps) {
  const present = useMenuPresentation();
  const labelOf = (href: string) => (!defaultNames && present(href)?.label) || menuMentionDestination(href)?.label || "메뉴";
  const [value, setValue] = useState(defaultValue);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const listId = useId();
  const helpId = useId();
  const updateSuggestion = (editor: Editor) => { setSuggestion(suggestionAt(editor)); setActive(0); };
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false, heading: false, horizontalRule: false, italic: false, link: false, listItem: false, listKeymap: false, orderedList: false, strike: false, underline: false, trailingNode: false }),
      Placeholder.configure({ placeholder, showOnlyWhenEditable: false }), // 비활성(권한 잠금)일 때도 안내가 보이게(write-lock.ts)
      Node.create({
        name: "menuMention", group: "inline", inline: true, atom: true, selectable: true,
        addOptions: () => ({ defaultNames }),
        addAttributes: () => ({ href: { default: "", parseHTML: (el) => el.getAttribute("data-menu-href") }, label: { default: "메뉴" } }),
        parseHTML: () => [{ tag: "span[data-menu-href]", getAttrs: (el) => menuMentionDestination(el.getAttribute("data-menu-href") ?? "") ? {} : false }],
        renderHTML: ({ node }) => ["span", { "data-menu-href": node.attrs.href, class: "bg-primary-soft text-primary rounded px-1 py-0.5 font-semibold", contenteditable: "false" }, `@${labelOf(String(node.attrs.href))}`],
        renderText: ({ node }) => menuMentionToken(String(node.attrs.href)),
        addNodeView: () => ReactNodeViewRenderer(MentionChip),
        addProseMirrorPlugins: () => [new Plugin({ filterTransaction: (tr, state) => {
          if (!tr.docChanged) return true;
          const length = serialize(tr.doc).length;
          if (length <= maxLength || length < serialize(state.doc).length) return true;
          // IME 조합 도중은 자르지 않는다. 저장 시 아래 유효성 입력과 서버 상한이 막는다.
          if (tr.getMeta("composition") !== undefined) return true;
          queueMicrotask(() => setLimitReached(true));
          return false;
        } })],
      }),
    ],
    content: documentOf(defaultValue, labelOf),
    editorProps: { attributes: { role: "textbox", "aria-label": ariaLabel, "aria-multiline": "true", "aria-describedby": helpId, "aria-autocomplete": "list", "aria-haspopup": "listbox",
      ...(suggestion ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${active}` } : {}),
      class: "max-h-[480px] overflow-auto px-3 py-2 text-sm leading-relaxed outline-none whitespace-pre-wrap [&_p]:min-h-6 [&_.is-editor-empty:first-child::before]:text-text-faint [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:pointer-events-none",
      style: `min-height:${minHeight}px`,
    }, handlePaste: (view, event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return false;
      const doc = view.state.schema.nodeFromJSON(documentOf(text, labelOf));
      // 열려 있는 문단 경계로 붙인다. 닫힌 slice는 문장 중간에 앞/뒤 문단을 새로 만든다.
      view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)));
      return true;
    } },
    onUpdate: ({ editor }) => { const next = serialize(editor.state.doc); setValue(next); onChange?.(next); setLimitReached(next.length > maxLength); updateSuggestion(editor); },
    onSelectionUpdate: ({ editor }) => updateSuggestion(editor),
  });
  // 잠금이 바뀌면(권한 판정이 나중에 내려오는 화면 등) 편집 가능 여부만 갈아 끼운다 — 편집기를 다시 만들지 않는다.
  // emitUpdate=false — 마운트 때 update가 나가 onChange가 저절로 불리지 않게(기존 화면 동작 그대로).
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  const query = suggestion?.query.trim().toLocaleLowerCase() ?? "";
  const candidates = MENU_MENTION_CATALOG.filter((d) => `${d.label} ${labelOf(d.href)}`.toLocaleLowerCase().includes(query));
  const choose = (href: string) => {
    if (!editor || !suggestion) return;
    editor.chain().focus().insertContentAt({ from: suggestion.from, to: suggestion.to }, [
      { type: "menuMention", attrs: { href, label: labelOf(href) } }, { type: "text", text: " " },
    ]).run();
    setSuggestion(null);
  };
  return <div className="mt-1 space-y-2">
    <div aria-disabled={disabled || undefined} className={`border-line bg-card rounded-lg border focus-within:border-primary ${disabled ? "bg-bg-soft opacity-70" : ""}`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSuggestion(null); }}
      onKeyDownCapture={(e) => {
        if (!suggestion || e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSuggestion(null); }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && candidates.length) {
          e.preventDefault(); e.stopPropagation();
          const index = (active + (e.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
          setActive(index); document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
        }
        if (e.key === "Enter" && candidates[active]) { e.preventDefault(); e.stopPropagation(); choose(candidates[active].href); }
      }}>
      <EditorContent editor={editor} />
      {suggestion && !disabled ? <div className="border-line border-t p-2">
        <p className="text-text-dim px-2 py-1 text-xs">메뉴 선택 · ↑↓ 이동 · Enter 선택 · Esc 닫기</p>
        <div id={listId} role="listbox" aria-label="참조할 메뉴" className="max-h-56 overflow-y-auto">
          {candidates.length ? candidates.map((d, index) => <button type="button" key={d.href} id={`${listId}-${index}`} role="option" aria-selected={active === index}
            onMouseDown={(e) => e.preventDefault()} onClick={() => choose(d.href)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active === index ? "bg-primary-soft" : "hover:bg-bg-soft"}`}>
            <MenuGlyph name={(!defaultNames && present(d.href)?.icon) || d.icon} size={18} /><span className="min-w-0 break-words">@{labelOf(d.href)}{labelOf(d.href) !== d.label ? <span className="text-text-faint ml-2 text-xs">기본: {d.label}</span> : null}</span>
          </button>) : <p className="text-text-dim px-2 py-3 text-sm">일치하는 메뉴가 없습니다. 기본 이름으로도 검색할 수 있습니다.</p>}
        </div>
      </div> : null}
    </div>
    {name ? <input type="hidden" name={name} value={value} /> : null}
    {/* 비활성이면 숨기되 지우지는 않는다 — 편집기의 aria-describedby가 이 id를 가리킨다. */}
    <p id={helpId} hidden={disabled} className="text-text-dim text-xs">메뉴를 설명할 때는 <strong className="text-primary">@를 입력해 선택해 주세요.</strong> 각 지점에서는 설정한 이름으로, 운영자에게는 기본 메뉴 이름으로 표시됩니다.</p>
    {limitReached ? <p className="text-danger text-xs" role="alert">내용은 메뉴 참조를 포함해 {maxLength.toLocaleString()}자까지 입력할 수 있습니다.</p> : null}
  </div>;
}
