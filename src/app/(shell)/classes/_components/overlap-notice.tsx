"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { overlapItemLabel, overlapSummary, type OverlapItem } from "@/features/classes/overlap";

/**
 * 겹침 **상세 경고** — 저장은 이미 끝났고(정규·특강 모두 차단 없음, 원장 확정 2026-07-22),
 * "몇 개 반과 몇 건이 · 어떤 반과 · 언제 · 무엇(강의실/강사) 때문에" 겹치는지 전부 보여준다.
 *
 * ⚠️ 톤은 **알림(파랑)** — 빨간 오류가 아니다. 합반은 실제 운영이라(활성 반끼리 같은 교실·시각 겹침이
 *    실데이터에 578쌍) 겹침은 사고가 아니라 정상 업무다. "막혔다"고 읽히면 안 된다.
 * ⚠️ 문구는 전부 한글(raw 영문 요일 키·enum 노출 금지) — `dayLabel`·라벨 헬퍼만 쓴다.
 */
const PREVIEW_COUNT = 5;

export function OverlapNotice({
  items,
  onConfirm,
  onStay,
}: {
  items: OverlapItem[];
  /** '확인' — 경고를 닫고 저장된 반으로 이동(폼이 붙잡아 둔 네비게이션을 푼다). */
  onConfirm: () => void;
  /** '계속 편집' — 이동 없이 경고만 닫는다. 수정 폼에서만(생성 폼은 재제출=중복 생성이라 미노출). */
  onStay?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, PREVIEW_COUNT);
  const hidden = items.length - shown.length;

  return (
    <section
      aria-live="polite"
      className="border-blue/25 bg-blue-soft rounded-2xl border px-4 py-3.5"
    >
      <header className="flex items-start gap-2">
        <EyIcon name="alertCircle" size={16} className="text-blue mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold break-keep">
            저장했습니다 — {overlapSummary(items)}
          </p>
          <p className="text-text-dim mt-0.5 text-xs break-keep">
            합반처럼 의도한 겹침이면 그대로 두셔도 됩니다. 아니라면 강의실·강사·시간을 조정하세요.
          </p>
        </div>
      </header>

      <ul className="mt-3 space-y-1">
        {shown.map((o) => (
          // key = 서버 dedup 키와 동일 구성(끝시각 포함) — 같은 반·같은 시작의 다른 길이 슬롯이 있으면 충돌한다.
          <OverlapRow
            key={`${o.kind}|${o.classId}|${o.dayOfWeek}|${o.startTime}|${o.endTime}`}
            item={o}
          />
        ))}
      </ul>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-text-dim hover:text-foreground mt-2 text-xs underline underline-offset-2"
        >
          {expanded ? "접기" : `${hidden}건 더 보기`}
        </button>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={onConfirm}>
          확인
        </Button>
        {onStay ? (
          <Button type="button" size="sm" variant="outline" onClick={onStay}>
            계속 편집
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** 한 줄 = [원인 알약] 대상이름 · 요일 시각 · 반 이름. 강의실(호박)·강사(보라)를 색으로 구분. */
function OverlapRow({ item }: { item: OverlapItem }) {
  const isRoom = item.kind === "classroom";
  const who = isRoom ? (item.roomName ?? "같은 강의실") : (item.teacherName ?? "같은 강사");
  return (
    <li
      title={overlapItemLabel(item)}
      className="bg-card/70 border-line flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs"
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          isRoom ? "bg-amber-soft text-amber" : "bg-purple-soft text-purple"
        }`}
      >
        <EyIcon name={isRoom ? "doorOpen" : "user"} size={11} />
        {isRoom ? "강의실" : "강사"}
      </span>
      <span className="text-foreground font-medium break-keep">{who}</span>
      <span className="text-text-faint" aria-hidden>
        ·
      </span>
      <span className="num text-text-dim">
        {item.dayLabel} {item.startTime}~{item.endTime}
      </span>
      <span className="text-text-faint" aria-hidden>
        ·
      </span>
      <span className="text-foreground min-w-0 break-keep">{item.className}</span>
    </li>
  );
}
