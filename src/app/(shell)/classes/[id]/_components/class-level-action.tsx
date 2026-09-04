"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { isLevelClassName, type LevelChange } from "@/features/timetable/lib/level";
import { changeClassLevel } from "@/features/timetable/server/actions";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 영어 레벨반 원클릭 레벨 변경 — 반 상세 헤더 액션.
 * 반이름이 레벨 규칙(예: DP3)이면 숫자/레벨 ↑↓ 버튼으로 className을 변경(changeClassLevel).
 * 이전엔 시간표 셀 우측 drawer(class-detail-drawer)에만 있던 기능을 반 상세(/classes/[id])로 이전.
 * 규칙명이 아니거나 영어 과목이 아니면 아무것도 렌더하지 않는다.
 */
export function ClassLevelAction({
  classId,
  className,
  subject,
}: {
  classId: string;
  className: string;
  subject: string;
}) {
  const router = useRouter();
  const t = useSheetT();
  const [leveling, startLevel] = useTransition();
  const [levelError, setLevelError] = useState<string | null>(null);

  if (subject !== "english" || !isLevelClassName(className)) return null;

  function doLevel(change: LevelChange) {
    setLevelError(null);
    startLevel(async () => {
      const res = await changeClassLevel(classId, change);
      if (res?.error) setLevelError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="border-border flex items-center gap-1 rounded-lg border p-1">
        <span className="text-muted-foreground inline-flex items-center gap-1 pr-0.5 pl-1 text-xs">
          {t("cls.lv.label")}
          {leveling ? <Loader2 className="text-primary size-3 animate-spin" /> : null}
        </span>
        <Button
          variant="outline"
          size="xs"
          disabled={leveling}
          onClick={() => doLevel("number-up")}
          title={t("cls.lv.numberUp")}
        >
          <ChevronUp />
          {t("cls.lv.number")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={leveling}
          onClick={() => doLevel("number-down")}
          title={t("cls.lv.numberDown")}
        >
          <ChevronDown />
          {t("cls.lv.number")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={leveling}
          onClick={() => doLevel("class-up")}
          title={t("cls.lv.classUp")}
        >
          <ChevronUp />
          {t("cls.lv.level")}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={leveling}
          onClick={() => doLevel("class-down")}
          title={t("cls.lv.classDown")}
        >
          <ChevronDown />
          {t("cls.lv.level")}
        </Button>
      </div>
      {levelError ? <p className="text-chart-4 text-xs">{levelError}</p> : null}
    </div>
  );
}
