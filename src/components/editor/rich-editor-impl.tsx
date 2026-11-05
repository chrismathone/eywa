"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";

/**
 * 리치 텍스트 에디터 본체(TipTap) — **표를 쓸 수 있는 사유/본문 입력**.
 * 원장 요구(2026-08-14): *"사유는 저렇게 쓰면 표나 이런 거 못 쓰니까 에디터 가져오자."*
 *
 * 🔑 **왜 TipTap인가**: 네이버 스마트에디터는 배포용 npm 패키지가 없고(구형 스크립트 임베드),
 *    react-quill·toast-ui는 React 19 지원이 멈췄다. TipTap은 헤드리스라 툴바·본문을 **우리 토큰으로**
 *    직접 그린다 — 남의 디자인이 섞여 들어오지 않는다(Editorial 팔레트 유지).
 *
 * ⚠️ 이 파일은 **절대 직접 import하지 말 것** — `rich-editor.tsx`(next/dynamic 래퍼)를 쓴다.
 *    ProseMirror 묶음이 수백 KB라 정적 import는 첫 페인트를 막는다(B5).
 * ⚠️ 값은 **hidden input**으로 폼에 실린다 — 서버 액션은 FormData로 받고, 저장 전 반드시
 *    `sanitizeRichHtml`을 거친다(저장형 XSS 차단은 서버 몫이다. 여기서 거르는 건 게이트가 아니다 [[#77]]).
 * ⚠️ 본문 클래스 `.rich-content`는 **뷰어와 공유**(globals.css) — 쓸 때와 읽을 때 서식이 같아야 한다.
 */

type Props = {
  /** 폼 필드 이름 — 이 이름의 hidden input에 HTML이 실린다. */
  name: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** 고칠 때마다 HTML을 알린다(폼 밖 상태로 들고 있는 화면용 — 업무 요청). */
  onChange?: (html: string) => void;
  /** 쓰기 권한이 없을 때 — 편집을 막고 툴바를 숨긴다. 안내는 placeholder로(원장 2026-11-05). */
  disabled?: boolean;
};

/** 툴바 버튼 하나 — 아이콘이 없는 서식은 글자(B·I·U)로 낸다(아이콘을 억지로 끼워 맞추지 않는다). */
function ToolButton({
  onClick,
  active,
  disabled,
  label,
  icon,
  text,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  icon?: AywaIconName;
  text?: string;
  }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // 버튼을 눌러도 본문 선택이 풀리지 않게
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sm transition disabled:opacity-30 ${
        active ? "bg-primary-soft text-primary font-bold" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      {icon ? <EyIcon name={icon} size={15} /> : <span aria-hidden>{text}</span>}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="bg-line mx-0.5 h-4 w-px shrink-0" />;
}

/** 표 조작 묶음 — 표 안에 커서가 있을 때만 펼친다(평소엔 '표' 버튼 하나). */
function TableTools({ editor }: { editor: Editor }) {
  const inTable = editor.isActive("table");
  return (
    <>
      <ToolButton
        label="표 삽입 (3×3)"
        icon="spreadsheet"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      />
      {inTable ? (
        <>
          <ToolButton label="행 추가" text="+행" onClick={() => editor.chain().focus().addRowAfter().run()} />
          <ToolButton label="행 삭제" text="−행" onClick={() => editor.chain().focus().deleteRow().run()} />
          <ToolButton label="열 추가" text="+열" onClick={() => editor.chain().focus().addColumnAfter().run()} />
          <ToolButton label="열 삭제" text="−열" onClick={() => editor.chain().focus().deleteColumn().run()} />
          <ToolButton
            label="표 삭제"
            icon="trash"
            onClick={() => editor.chain().focus().deleteTable().run()}
          />
        </>
      ) : null}
    </>
  );
}

export function RichEditorImpl({ name, defaultValue = "", placeholder, ariaLabel, onChange, disabled = false }: Props) {
  const [html, setHtml] = useState(defaultValue);

  const editor = useEditor({
    // ssr:false로만 마운트되지만, 하이드레이션 경고를 확실히 없애려고 명시한다.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      // StarterKit v3에 굵게·기울임·밑줄·취소선·목록·제목·인용·코드·링크·실행취소가 모두 들어 있다.
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] },
        heading: { levels: [1, 2, 3] },
      }),
      TableKit.configure({ table: { resizable: false } }), // 열 너비는 저장하지 않는다(sanitize가 style을 뗀다)
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // showOnlyWhenEditable: false — 기본값(true)이면 비활성(권한 잠금)일 때 placeholder 장식을 아예 안 만들어
      // "○○ 작성 권한이 필요합니다" 안내가 보이지 않는다(write-lock.ts · 2026-11-05 리뷰). 편집 가능한 화면은 그대로다.
      Placeholder.configure({ placeholder: placeholder ?? "내용을 입력하세요", showOnlyWhenEditable: false }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        // 본문 서식은 뷰어와 공유하는 .rich-content가 정한다.
        class: "rich-content min-h-[220px] px-3.5 py-3 outline-none",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = e.getHTML();
      setHtml(next);
      onChange?.(next);
    },
  });

  // 언마운트 정리 — 에디터 인스턴스가 남으면 ProseMirror 뷰가 DOM을 붙든다.
  useEffect(() => () => editor?.destroy(), [editor]);
  // 권한이 바뀌어 다시 그려질 때도 편집 가능 여부를 맞춘다(useEditor 옵션은 처음 한 번만 읽힌다).
  useEffect(() => {
    // emitUpdate=false — 기본값(true)이면 마운트 때마다 update가 나가 onChange가 저절로 한 번 불린다(비활성이 아닌 기존 화면 포함).
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  if (!editor) return <EditorSkeleton />;

  const link = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("링크 주소 (비우면 해제)", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div
      className={`border-line rounded-lg border transition ${disabled ? "bg-bg-soft/40 cursor-not-allowed" : "bg-card focus-within:border-primary"}`}
      aria-disabled={disabled || undefined}
    >
      <input type="hidden" name={name} value={html} />

      {/* 툴바 — 좁은 창에서는 가로 레일로 흐른다(줄바꿈으로 키가 커지지 않게). */}
      {disabled ? null : (
      <div className="border-line flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        <ToolButton
          label="굵게"
          text="B"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          label="기울임"
          text="I"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          label="밑줄"
          text="U"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolButton
          label="취소선"
          text="S"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <Divider />
        <ToolButton
          label="글머리 목록"
          icon="list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolButton
          label="번호 목록"
          text="1."
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <Divider />
        <TableTools editor={editor} />
        <Divider />
        <ToolButton
          label="링크"
          icon="externalLink"
          active={editor.isActive("link")}
          onClick={link}
        />
        <Divider />
        <ToolButton
          label="왼쪽 정렬"
          text="≡"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <ToolButton
          label="가운데 정렬"
          text="≡"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolButton
          label="오른쪽 정렬"
          text="≡"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <Divider />
        <ToolButton
          label="실행 취소"
          icon="undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        {/* 다시 실행 아이콘이 따로 없어 실행취소를 좌우 반전해 쓴다(같은 몸짓의 반대 방향). */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="다시 실행"
          aria-label="다시 실행"
          className="text-text-dim hover:bg-bg-soft inline-flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:opacity-30"
        >
          <span className="scale-x-[-1]">
            <EyIcon name="undo" size={15} />
          </span>
        </button>
      </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}

/** 로딩·초기화 전 자리(래퍼의 loading과 같은 모양이라 깜빡임이 없다). */
export function EditorSkeleton() {
  return (
    <div className="border-line bg-card rounded-lg border">
      <div className="border-line bg-bg-soft/40 h-9 animate-pulse border-b" />
      <div className="h-[220px] animate-pulse" />
    </div>
  );
}

export default RichEditorImpl;
