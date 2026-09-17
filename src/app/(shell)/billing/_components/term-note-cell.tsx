"use client";
import { useRef, useState, useTransition } from "react";
import { updateSessionTermNote } from "@/features/billing/session-terms/server/note-actions";
import { normalizeTermNote, TERM_NOTE_MAX } from "@/features/billing/session-terms/term-note";
import { tipProps } from "@/components/hover-tip/tip";
import { publishRecordSaved } from "@/lib/realtime/record-channel";

/**
 * 회차 확정 표의 메모(특이사항) 칸 — 원장 2026-09-17. 누르면 그 자리에서 고치고 Enter·칸 밖 클릭 = 저장, Esc = 취소.
 *
 * 🔴 한 행 = 한 줄 규약 안에 선다 — 칸에는 한 줄만(말줄임), 전문은 마우스 오버 카드(메모 툴팁 = 카드 규약, 같은 값에
 *    `title`을 겹치지 않는다). 메모가 없는 칸은 평소엔 비어 보이고, 행에 마우스를 올리거나 초점이 오면 '메모'가 선다
 *    (수백 행마다 같은 글자를 세우면 표가 시끄럽다).
 * ⚠️ 확정값과 다른 경로다 — `useSessionTermsState().apply`를 타지 않는다(그 경로는 배분 표시를 '재확인'으로 되돌린다).
 */
export function TermNoteCell({ id, note, studentName }: { id: string; note: string | null; studentName: string }) {
  // 서버 값이 새로 오면(재조회) 그 값으로 — 그전까진 방금 저장한 값을 보여 준다.
  const [state, setState] = useState({ source: note, shown: note });
  if (state.source !== note) setState({ source: note, shown: note });
  const shown = state.source === note ? state.shown : note;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Enter로 저장한 뒤 입력칸이 사라지며 blur가 한 번 더 오는 경우를 막는다(같은 저장 두 번).
  const settled = useRef(false);

  function open() {
    settled.current = false;
    setValue(shown ?? "");
    setError(null);
    setEditing(true);
  }
  function cancel() {
    settled.current = true;
    setEditing(false);
    setError(null);
  }
  function commit() {
    if (settled.current || pending) return;
    if (normalizeTermNote(value) === shown) return cancel();
    settled.current = true;
    start(async () => {
      try {
        const result = await updateSessionTermNote(id, value);
        if (result.error) {
          settled.current = false;
          setError(result.error);
          return;
        }
        setState({ source: note, shown: result.note ?? null });
        setEditing(false);
        // 다른 창의 회차 확정 표가 옛 메모를 들고 있다가 덮어쓰지 않게 알린다(확정·배분 저장과 같은 신호).
        publishRecordSaved("billing:session-terms");
      } catch {
        settled.current = false;
        setError("메모를 저장하지 못했습니다. 다시 시도해 주세요");
      }
    });
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <input
          type="text"
          autoFocus
          maxLength={TERM_NOTE_MAX}
          value={value}
          disabled={pending}
          aria-label={`${studentName} 메모`}
          aria-invalid={error ? true : undefined}
          placeholder="특이사항"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter·Esc는 조합을 끝내는 키다 — 저장·취소로 읽지 않는다(grid-nav 규약).
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs disabled:opacity-60"
        />
        {error ? (
          <p role="alert" className="text-danger text-xs whitespace-normal">
            {error}{" "}
            {/* 저장 중 입력칸이 잠겨 초점이 빠지면 Esc가 안 먹는다 — 닫는 문을 따로 둔다(리뷰 2026-09-17). */}
            {/* mousedown 기본 동작을 막아 입력칸 blur(=저장)가 먼저 오지 않게 한다. */}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel} className="text-text-dim underline underline-offset-2">
              취소
            </button>
          </p>
        ) : null}
      </div>
    );
  }
  if (!shown) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={`${studentName} 메모 추가`}
        // 마우스가 없는 기기(태블릿)는 hover가 없어 늘 옅게 보인다.
        className="text-text-dim hover:text-primary block w-full text-left text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
      >
        메모
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`${studentName} 메모 수정: ${shown}`}
      className="hover:text-primary block w-full truncate text-left text-sm"
      {...tipProps({ title: "메모", lines: [shown] })}
    >
      {shown}
    </button>
  );
}
