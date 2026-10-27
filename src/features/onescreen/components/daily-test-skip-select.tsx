"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import { TEST_SKIP_REASONS, testSkipComplete, type DailyTestSkip, type TestSkipReason } from "../math-report-pilot-sections";
import { TEST_SKIP_REASON_KEY } from "./daily-test-skip-panel";
import { SearchableSelect } from "@/components/ui/searchable-select";

/** 드롭다운 맨 아래 '시험 있음' — 사유 키와 겹치지 않는 값. */
const TAKEN = "__taken";

/**
 * 표 행의 일일 테스트 '시험 없음' — 좁은 점수 칸(88px)에 카드의 사유 판을 통째로 펼치면 글자가 한 자씩 세로로
 * 쪼개졌다(원장 2026-10-27 *"그냥 드롭다운으로 선택하면 안깨지지않나?"*). 사유는 드롭다운 하나로 고르고,
 * 맨 위 '시험 있음'을 고르면 점수 칸으로 돌아간다. '기타'(또는 카드에서 적은 덧붙임)만 아래 한 줄 입력.
 * 잠금은 호출부 칸의 fieldset이 건다(드롭다운 버튼·입력 모두 그 안에 있다).
 */
export function DailyTestSkipSelect({
  skip,
  ariaLabel,
  onChange,
}: {
  skip: DailyTestSkip;
  ariaLabel: string;
  /** null = 시험 있음. */
  onChange: (skip: DailyTestSkip | null) => void;
}) {
  const t = useSheetT();
  const done = testSkipComplete(skip);
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-xs font-bold ${done ? "text-text-dim" : "text-danger"}`}>{t("os.card.testSkip.no")}</span>
      {/* 고른 사유는 버튼 밖에 글자로(접혀도 다 보이게) — 칸 폭 88px에선 버튼 안 글자가 '안 …'으로 잘렸다(2026-10-27 실화면). */}
      {skip.reason ? <span className="text-foreground text-xs leading-snug break-keep">{t(TEST_SKIP_REASON_KEY[skip.reason])}</span> : null}
      {/* FieldSelect는 쓰지 않는다 — 그 '선택 안 함' 줄이 빈 값과 같아, 사유를 안 고른 칸이 '시험 있음'으로 보였다. */}
      <SearchableSelect
        options={[
          ...TEST_SKIP_REASONS.map((r) => ({ value: r, label: t(TEST_SKIP_REASON_KEY[r]) })),
          { value: TAKEN, label: t("os.card.testSkip.yes") },
        ]}
        // 버튼은 짧은 말('사유'·'변경')만 — 고른 값은 위 글자가 보여 준다.
        value=""
        onValueChange={(v) => {
          if (v === TAKEN) onChange(null);
          else if ((TEST_SKIP_REASONS as readonly string[]).includes(v)) onChange({ ...skip, reason: v as TestSkipReason });
        }}
        placeholder={skip.reason ? t("os.row.testSkipChange") : t("os.row.testSkipPick")}
        ariaLabel={ariaLabel}
        searchPlaceholder={t("select.search")}
        // 이웃 입력칸(표)과 같은 치수 — field-select.tsx의 표 트리거와 한 벌. 사유가 비면 붉은 테두리.
        triggerClassName={`bg-card text-foreground focus:border-primary h-8 rounded-sm border px-2 text-xs outline-none ${
          done ? "border-line" : "border-danger"
        }`}
      />
      {skip.reason === "other" || skip.detail ? (
        <input
          type="text"
          value={skip.detail}
          maxLength={200}
          onChange={(e) => onChange({ ...skip, detail: e.target.value })}
          placeholder={skip.reason === "other" ? t("os.card.testSkip.detailPhOther") : t("os.card.testSkip.detailPh")}
          title={skip.detail || undefined}
          aria-label={t("os.card.testSkip.detailAria")}
          className="border-line bg-card focus:border-primary h-8 w-full min-w-0 rounded-sm border px-2 text-xs outline-none"
        />
      ) : null}
    </div>
  );
}
