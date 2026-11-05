"use client";

/**
 * 교재요청 "학부모에게 보낼 메시지"(멘트) — 입력칸 + 중간저장 훅.
 *
 * 강사 폼(/textbook-requests)·사무실 다이얼로그(/billing 교재)·발송 다이얼로그가 **같은 값**을 쓰도록
 * 여기 한 곳에 둔다. 값은 내 계정(users.textbook_notice_ment)에 저장돼 다음 작성에 그대로 뜬다.
 *
 * ⚠️ 메모(textbook_orders.notes)는 사무실 내부용이라 학부모에게 나가지 않는다 — 이 칸이 학부모용이다.
 * ⚠️ 디바운스는 타이머로만(effect 안 동기 setState 금지 #25). 닫기가 1.5초보다 빨라도 마지막 타이핑이
 *    유실되지 않게 언마운트 때 예약분을 즉시 저장(flush)한다.
 */

import { useEffect, useRef, useState } from "react";
import { useModuleOn } from "@/features/owner/operations-context";
import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import { loadMyTextbookMent, saveMyTextbookMent } from "./server/textbook-notice-actions";
import { DEFAULT_TEXTBOOK_MENT } from "./textbook-notice";

/** 입력이 멈추고 이 시간이 지나면 저장. */
const MENT_SAVE_DELAY = 1500;

export function useMentDraft(options?: { autoLoad?: boolean }) {
  const [ment, setMentState] = useState(DEFAULT_TEXTBOOK_MENT);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null); // 아직 저장 안 된 마지막 입력(닫을 때 flush)
  const dirty = useRef(false); // 사용자가 한 번이라도 고쳤는가 — 늦게 도착한 서버값이 덮지 않게

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void saveMyTextbookMent(pending.current);
    },
    [],
  );

  const autoLoad = options?.autoLoad ?? false;
  useEffect(() => {
    if (!autoLoad) return;
    let cancelled = false;
    void (async () => {
      const saved = await loadMyTextbookMent();
      // 불러오는 사이 사용자가 이미 타이핑했으면 그 입력이 이긴다(apply의 dirty 가드와 동일 규칙).
      if (!cancelled && !dirty.current) setMentState(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLoad]);

  /** 사용자 편집 — 화면 반영 + 디바운스 저장 예약. */
  const edit = (v: string) => {
    dirty.current = true;
    setMentState(v);
    pending.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = null;
      void saveMyTextbookMent(v);
    }, MENT_SAVE_DELAY);
  };

  /** 서버에서 불러온 기본값 주입 — 저장을 예약하지 않고(되쓰기 방지), 이미 고친 입력도 덮지 않는다. */
  const apply = (v: string) => {
    if (!dirty.current) setMentState(v);
  };

  return { ment, edit, apply };
}

/** 작성 폼용 입력칸 — 메모(내부용) 바로 아래에 두어 "이건 학부모에게 나간다"를 분명히 한다. */
export function TextbookMentField({
  value,
  onChange,
  rows = 3,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  /**
   * 읽기 권한(교재 요청 쓰기 없음) — 칸을 잠그고 권한 안내를 띄운다(원장 2026-11-05, write-lock.ts).
   * 잠그면 onChange가 안 불려 자동 저장(saveMyTextbookMent)도 일어나지 않는다.
   */
  disabled?: boolean;
}) {
  // 이 문구는 ClassNote 발송에만 쓰인다 — ClassNote 기능이 꺼진 학원엔 칸 자체가 없다(2026-09-30 "꺼지면 흔적 없이").
  const classnoteOn = useModuleOn("classnote");
  if (!classnoteOn) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">학부모에게 보낼 메시지</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        aria-label="학부모에게 보낼 메시지"
        disabled={disabled}
        className={`border-line bg-background text-foreground placeholder:text-text-faint focus:ring-primary/40 min-h-[76px] w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${TEXTAREA_AUTOSIZE}`}
        placeholder={disabled ? writeLockedPlaceholder("textbook_requests") : DEFAULT_TEXTBOOK_MENT}
      />
      {/* 저장된 문구가 차 있으면 placeholder가 안 보인다 — 잠긴 칸은 안내 한 줄로 대신한다. */}
      <p className="text-text-faint text-xs">
        {disabled ? (
          writeLockedNote("textbook_requests")
        ) : (
          <>
            학부모에게 보내는 안내 문구입니다 (메모는 사무실 내부용이라 나가지 않습니다) ·{" "}
            {"{학생}·{교재명}·{금액}"}은 학생마다 자동으로 채워집니다 · 입력을 멈추면 자동 저장됩니다.
          </>
        )}
      </p>
    </div>
  );
}
