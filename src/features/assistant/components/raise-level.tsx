"use client";

import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ASSISTANT_LEVEL_HINT, ASSISTANT_LEVEL_LABEL, raiseLevelsFor, type AssistantLevel } from "@/features/assistant/levels";
import { pickJosa } from "@/lib/text/josa";
import type { Turn } from "./assistant-state";

/**
 * '적음'으로 끝난 답 아래 — *"마음에 들지 않으면 추론 강도를 올려서 다시 물어보시겠습니까?"*(원장 2026-11-12).
 * 문구는 한 줄을 다 쓰고 단추는 그 아래로 접힌다(폰 폭에서 문구가 세로 기둥이 됐다 · 적대 리뷰). 단추에 그 강도의 안내(느리고 비쌈 등)를 카드로.
 */
export function RaiseLevel({ turn, disabled, onRetryAt }: { turn: Turn; disabled: boolean; onRetryAt: (t: Turn, level: AssistantLevel) => void }) {
  const levels = raiseLevelsFor(turn.level);
  if (levels.length === 0) return null;
  return (
    <div className="border-line flex flex-wrap items-center gap-2 border-t pt-3">
      <p className="text-text-dim basis-full text-sm sm:min-w-0 sm:flex-1 sm:basis-auto">마음에 들지 않으면 추론 강도를 올려서 다시 물어보시겠습니까?</p>
      {levels.map((level) => {
        const label = ASSISTANT_LEVEL_LABEL[level];
        return (
          <Button
            key={level}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onRetryAt(turn, level)}
            {...tipProps({ title: `추론 ${label}`, lines: [ASSISTANT_LEVEL_HINT[level]] })}
          >
            <EyIcon name="undo" />
            {`${label}${pickJosa(label, "으로")} 다시 묻기`}
          </Button>
        );
      })}
    </div>
  );
}
