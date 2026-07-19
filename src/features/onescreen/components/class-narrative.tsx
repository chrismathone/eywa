"use client";

/**
 * 반 공통 서술 팝오버(G6) — 강사가 반 단위로 수업 맥락을 1회 쓰면, 이후 AI 자동작성(개별·일괄)이
 * 각 학생의 점수·태도와 결합해 서로 다른 멘트로 분기한다("반 서술 1회 = 학생 N명의 서로 다른 멘트").
 * 서술은 **생성 재료**(기록 아님) — 부모(onescreen-client)가 sessionStorage(날짜 키)로 새로고침만 방어.
 * 반 필터가 특정 반일 때만 활성(전체 뷰=비활성+안내 — 순서 버튼 #22 발견성 패턴). 300자 상한(서버와 동일).
 */
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";

export const CLASS_NARRATIVE_MAX = 300;

export function ClassNarrativePopover({
  activeClass,
  value,
  onSave,
  disabled,
}: {
  /** 특정된 단일 반 이름 — null(전체 보기·동명 반 모호)이면 버튼 비활성(어느 반 서술인지 특정 불가). */
  activeClass: string | null;
  /** 현재 반의 저장된 서술("" = 없음). */
  value: string;
  onSave: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const has = !!value.trim();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // 열 때 최신 값으로 동기(반 전환·외부 갱신 반영) — effect setState는 lint 금지(#25)라 이벤트에서.
        // 닫힘 시엔 draft 폐기(저장 버튼만 커밋).
        if (o) setDraft(value);
      }}
    >
      <Popover.Trigger
        disabled={disabled || !activeClass}
        className="text-text-dim hover:bg-bg-soft hover:text-foreground data-[popup-open]:bg-bg-soft inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50"
        title={
          activeClass
            ? "이 반의 오늘 수업 맥락을 한 번 적어두면, 자동작성이 학생별 점수·태도와 결합해 서로 다른 멘트를 만듭니다"
            : "반을 하나로 특정하면 그 반의 공통 수업 서술을 적을 수 있습니다(전체 보기·같은 이름 두 반은 비활성)"
        }
      >
        반 서술{has ? " ●" : ""}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[320px] flex-col gap-2 rounded-md border p-3 text-[12px] outline-none">
            <p className="text-text-dim text-[11px]">
              <span className="text-foreground font-bold">{activeClass}</span> 반 공통 수업 맥락 — 이후 자동작성부터
              학생별 사실과 결합됩니다(이미 쓴 멘트는 안 건드림)
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, CLASS_NARRATIVE_MAX))}
              rows={4}
              placeholder="예: 오늘은 2단원 심화 문제 위주로 진행. 대체로 이해도가 좋았고 응용 문제에서 시간이 걸렸음"
              aria-label="반 공통 수업 서술"
              className="border-line bg-card focus:border-primary w-full resize-none rounded-sm border px-2 py-1.5 text-[12px] outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-text-faint text-[11px]">
                {draft.length}/{CLASS_NARRATIVE_MAX}
              </span>
              <div className="flex gap-1.5">
                {has ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onSave("");
                      setOpen(false);
                    }}
                  >
                    지우기
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  onClick={() => {
                    onSave(draft.trim());
                    setOpen(false);
                  }}
                >
                  저장
                </Button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
