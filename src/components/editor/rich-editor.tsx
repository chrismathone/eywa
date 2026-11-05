"use client";

import dynamic from "next/dynamic";

/**
 * 리치 텍스트 에디터 — **소비처는 이 파일만 import한다**(구현은 지연로드).
 *
 * TipTap(ProseMirror) 묶음이 수백 KB라 정적 import는 페이지 첫 페인트를 막는다 → `next/dynamic`
 * `ssr:false` + 스켈레톤(B5 규칙, recharts `*-impl` 분리와 같은 패턴).
 *
 * 사용법 — 폼 안에 두면 `name`의 hidden input으로 HTML이 함께 제출된다:
 * ```tsx
 * <RichEditor name="reason" placeholder="예: 가족 행사" ariaLabel="사유" />
 * ```
 * 🔴 서버 액션은 받은 HTML을 **저장 전에 반드시** `sanitizeRichHtml`(src/lib/html/sanitize.ts)로
 *    거른다 — 결재 문서 본문은 남이 여는 글이라 저장형 XSS가 곧 세션 탈취다.
 */

const Impl = dynamic(() => import("./rich-editor-impl").then((m) => m.RichEditorImpl), {
  ssr: false,
  loading: () => (
    <div className="border-line bg-card rounded-lg border">
      <div className="border-line bg-bg-soft/40 h-9 animate-pulse border-b" />
      <div className="h-[220px] animate-pulse" />
    </div>
  ),
});

export function RichEditor(props: {
  /** 폼 필드 이름 — 이 이름의 hidden input에 HTML이 실린다. */
  name: string;
  defaultValue?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** 고칠 때마다 HTML을 알린다 — 폼 밖에서 상태로 들고 있는 화면용(업무 요청). 폼 안이면 필요 없다. */
  onChange?: (html: string) => void;
  /** 쓰기 권한이 없을 때 편집을 막는다(툴바 숨김). 안내는 placeholder로 — `writeLockedPlaceholder`(src/lib/write-lock.ts). */
  disabled?: boolean;
}) {
  return <Impl {...props} />;
}
