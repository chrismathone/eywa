"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { periodNotice } from "@/features/classes/period-notice";

// ⚠️ 라운드는 **형제 기준**(같은 폼의 반 이름·과목·강사 입력이 전부 rounded-md) — 한 폼 안에서 이 두 칸만
// 캐논값(lg)으로 두면 눈에 띄게 어긋난다. class-form의 입력 라운드를 옮길 땐 여기도 함께.
const inputClass =
  "border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm";

/**
 * 교시마다 기간이 갈릴 때의 안내 — 어느 칸이 갈리는지 **정확히** 말한다.
 * (예전엔 종료일이 갈릴 때만 알렸고, 시작일은 말없이 가장 이른 값으로 평탄화돼 과거 주 시간표가 거짓이 됐다.)
 */
const MIXED_TEXT: Record<"from" | "to" | "both", string> = {
  from: "이 반은 교시마다 운영 시작일이 다릅니다. 시작일 칸을 비워 두었습니다",
  to: "이 반은 교시마다 운영 종료일이 다릅니다. 종료일 칸을 비워 두었습니다",
  both: "이 반은 교시마다 운영 시작일·종료일이 다릅니다. 두 칸을 비워 두었습니다",
};

/**
 * 특강 토글 + 운영 기간(시작·종료일) — 반 생성/수정 폼의 한 섹션.
 *
 * ⚠️ **`isSpecial`을 두 번 보낸다**(hidden "0" → 체크박스 "1"): 체크박스만 두면 해제 시 필드가 통째로
 *    사라져 서버가 "이 폼은 특강 필드를 모른다"로 보고 **끄기가 저장되지 않는다**. hidden이 항상 붙어야
 *    `formData.getAll("isSpecial")`이 비지 않는다(서버 `isSpecialProvided` 계약).
 * ⚠️ `periodProvided=1`은 **기간 UI를 실제로 렌더한 폼만** 보낸다 — 이 값이 있어야 서버가 "종료일을 비운
 *    것"을 무기한으로 되돌리기(명시)로 해석한다. 없으면 기존 기간을 보존한다.
 * ⚠️ 갈리는(mixed) 칸은 부모가 **비워서** 프리필한다 — 값을 채워 보내면 그 한 값이 전 교시에 적용돼
 *    교시별 기간이 뭉개진다. 비면 서버가 교시별 기존값을 보존한다.
 */
export function ClassSpecialFields({
  isSpecial,
  onSpecialChange,
  defaultValidFrom,
  defaultValidTo,
  periodMixed,
  historyCount,
  validToError,
  periodError,
  hasSlots,
  today,
}: {
  isSpecial: boolean;
  onSpecialChange: (next: boolean) => void;
  defaultValidFrom?: string | null;
  defaultValidTo?: string | null;
  /** 교시마다 운영 기간이 제각각인 반 — 어느 칸이 갈리는지. 갈린 칸은 비워 프리필된다. */
  periodMixed?: "from" | "to" | "both";
  /** 운영이 끝난(이력) 교시 수 — 폼에 안 보이지만 저장해도 지워지지 않는다는 것을 알린다. */
  historyCount?: number;
  validToError?: string;
  /** 저장이 거절된 사유(서버 `validate` — 적을 교시가 없을 때). */
  periodError?: string;
  /**
   * 지금 이 폼이 들고 있는 편집 가능한 교시가 하나라도 있나 — **운영 기간은 교시 행에 저장되므로**
   * 없으면 날짜를 넣어도 저장될 자리가 없다(원장 제보 2026-08-27 "저장이 안되는데 알림멘트도 없어").
   */
  hasSlots: boolean;
  /** KST 오늘 — **서버가 넘긴다**(클라에서 new Date()로 만들면 자정 근처에 하이드레이션이 갈린다, [[#108]]). */
  today: string;
}) {
  // 날짜 미러 — 입력은 **비컨트롤드**(defaultValue) 그대로 두고 고지 계산에만 쓴다.
  // (컨트롤드로 바꾸면 초안 복원이 DOM에 직접 쓴 값과 갈린다.)
  const [fromValue, setFromValue] = useState(defaultValidFrom ?? "");
  const [toValue, setToValue] = useState(defaultValidTo ?? "");
  const notice = periodNotice({
    hasSlots,
    // 지난 배치가 있는데 교시가 0개 = "끝나서 사라진" 반 — 칸이 왜 비었는지 먼저 말한다.
    ...(historyCount ? { hasHistory: true } : {}),
    validFrom: fromValue || null,
    validTo: toValue || null,
    today,
  });
  return (
    <section className="space-y-3 border-t pt-4">
      <header>
        <h3 className="text-foreground text-sm font-bold">특강 · 운영 기간</h3>
        <p className="text-muted-foreground text-xs break-keep">
          특강은 시간표에서 따로 볼 수 있습니다.
        </p>
      </header>

      {/* 특강 토글 — hidden(0) + 체크박스(1) 쌍. 순서를 바꾸지 말 것(뒤 값이 체크 상태를 나타낸다). */}
      <input type="hidden" name="isSpecial" value="0" />
      <label className="border-line bg-bg-soft/60 flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2">
        <input
          type="checkbox"
          name="isSpecial"
          value="1"
          checked={isSpecial}
          onChange={(e) => onSpecialChange(e.target.checked)}
          className="size-4 shrink-0"
        />
        <EyIcon name="calendarClock" size={14} className="text-text-dim shrink-0" />
        <span className="text-foreground text-sm font-medium">특강 (방학 단기강좌)</span>
      </label>
      {/* ⚠️ 정직하게: 이 토글은 **시간표 구분**만 바꾼다. 급여 과정(초등/중등/…/특강)은 반 이름 자동
          판정 + 수납관리의 수동 지정이 진실이라, 토글만 켜도 정산 배분율은 달라지지 않는다. */}
      <p className="text-muted-foreground text-xs break-keep">
        시간표의 <span className="text-foreground">정규 / 특강</span> 구분에 쓰입니다. 급여 과정 분류는
        반 이름과 수납관리의 과정 지정을 따릅니다.
      </p>

      {/* 운영 기간 — 기간 UI를 렌더했다는 신호. 종료일 비우기 = 무기한으로 되돌리기(서버 계약). */}
      <input type="hidden" name="periodProvided" value="1" />
      {/* 단, 교시마다 종료일이 갈려 **폼이** 칸을 비운 경우엔 그 계약을 끈다 — 안 그러면 아무것도
          안 바꾸고 저장하기만 해도 교시별 종료일이 한 번에 지워진다(무기한으로). */}
      {periodMixed === "to" || periodMixed === "both" ? (
        <input type="hidden" name="periodKeepValidTo" value="1" />
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-foreground block text-sm font-medium" htmlFor="class-valid-from">
            운영 시작일 (선택)
          </label>
          <input
            id="class-valid-from"
            type="date"
            name="validFrom"
            defaultValue={defaultValidFrom ?? ""}
            onChange={(e) => setFromValue(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-foreground block text-sm font-medium" htmlFor="class-valid-to">
            운영 종료일 (선택)
          </label>
          <input
            id="class-valid-to"
            type="date"
            name="validTo"
            defaultValue={defaultValidTo ?? ""}
            onChange={(e) => setToValue(e.target.value)}
            className={inputClass}
          />
          {validToError ? <p className="text-chart-4 text-xs">{validToError}</p> : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs break-keep">
        비워두면 무기한. 종료일을 넣으면 그날 이후 시간표에서 자동으로 내려갑니다.
      </p>
      {/* 🔴 저장이 아무 일도 못 하는 경우를 **미리·사후 둘 다** 말한다(조용한 무저장 금지).
          periodError = 서버가 거절한 사유 / notice = 누르기 전 사전 고지. */}
      {periodError ? (
        <p className="border-danger/25 bg-danger-soft text-danger rounded-lg border px-3 py-2 text-xs break-keep">
          {periodError}
        </p>
      ) : null}
      {notice ? (
        <p className="border-amber/25 bg-amber-soft text-amber rounded-lg border px-3 py-2 text-xs break-keep">
          {notice.text}
        </p>
      ) : null}
      {periodMixed ? (
        <p className="border-amber/25 bg-amber-soft text-amber rounded-lg border px-3 py-2 text-xs break-keep">
          {MIXED_TEXT[periodMixed]} — 비운 채로 저장하면 교시별 날짜가 그대로 유지되고, 날짜를 넣으면 전
          교시가 그 날짜로 통일됩니다.
        </p>
      ) : null}
      {historyCount ? (
        <p className="text-muted-foreground text-xs break-keep">
          운영이 끝난 교시 {historyCount}개는 지난 배치 기록이라 아래 표에 표시하지 않습니다(저장해도
          지워지지 않습니다).
        </p>
      ) : null}
    </section>
  );
}
