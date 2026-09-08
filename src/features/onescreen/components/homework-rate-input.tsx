"use client";

import { handleGridNavKey } from "./grid-nav";
import { NONE_LABEL } from "../none-marker";
import { NOT_SUBMITTED, parseHomeworkRate } from "../homework-rate";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 과제 수행률 입력 — **숫자 한 칸 + `%`**(원장 2026-08-03: *"일일·확인처럼 두 칸으로. 숫자만 입력하면 자동 %처리."*).
 *
 * 🔴 왜 드롭다운이 아닌가: 선택지가 완료/일부 미흡/미제출 3단계였을 때 90% 해온 학생이 '일부 미흡'으로
 *    체크돼 학부모 그래프에 **50**으로 찍혔다(그 숫자를 보고 학부모가 학생을 혼냈다). 그렇다고 10% 눈금
 *    11개를 드롭다운에 넣으니 *"고르기 너무 힘들다"* — 정도를 아는 사람은 강사뿐이니 **그냥 치게** 한다.
 *
 * 모양은 옆 칸(일일·확인테스트 [`ScoreInput`](./score-input.tsx)) 점수 모드와 같다 — 숫자 칸 + 단위.
 * 저장값은 `"90%"` 문자열(퍼센트가 곧 값). `없음` = **지난 과제가 존재하지 않았음**(0%가 아니다 — 추세·그래프 제외).
 */
export function HomeworkRateInput({
  value,
  onChange,
  label,
  nav,
  size = "sm",
}: {
  /** 저장값 그대로("90%"·"없음"·""·옛 표기 "완료"). */
  value: string;
  onChange: (v: string) => void;
  label: string;
  nav?: { col: string; row: number };
  /** sm=표(촘촘) · lg=카드·일괄(이웃 입력칸과 같은 라운드). */
  size?: "sm" | "lg";
}) {
  const t = useSheetT();
  const v = value.trim();
  const isNone = v === NONE_LABEL;
  const isNotSubmitted = v === NOT_SUBMITTED;
  // 옛 표기(완료)도 숫자로 읽어 그대로 보여 준다 — 빈칸으로 보이면 값이 사라진 줄 안다.
  const n = isNone || isNotSubmitted ? null : parseHomeworkRate(value);
  const shown = n == null ? "" : String(n);
  const radius = size === "sm" ? "rounded-sm" : "rounded-lg";
  const chip = (on: boolean) =>
    `h-8 shrink-0 rounded-full border px-2 text-xs transition-colors ${
      on ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-faint"
    }`;

  return (
    // ⚠️ `flex-wrap` 필수 — 표 모드의 이 칸은 **고정 130px**(colgroup, table-fixed)이라 내용 폭
    // (숫자 48 + % + 알약 2개 ≈ 161px)이 칸을 넘는다. 한 줄로 두면 넘친 알약이 옆 칸(교재명)으로
    // 삐져나가고 그 칸의 **불투명 입력 배경에 덮여 글자가 잘린 것처럼 보였다**(원장 제보 2026-08-04
    // "라벨이 가려진다"). 행 높이는 옆 칸(학부모 문구 3칸)이 정하므로 아래로 접히는 여백은 남아돈다 —
    // 넘치면 다음 줄로 내리는 게 정답(학생·반 칸이 2026-07-30에 같은 이유로 이미 flex-wrap이다).
    // 카드·일괄(size=lg)은 폭이 넓어 그대로 한 줄로 남는다.
    <div className="flex flex-wrap items-center gap-1">
      <input
        inputMode="numeric"
        value={shown}
        disabled={isNone || isNotSubmitted}
        aria-label={label}
        placeholder="—"
        data-nav-col={nav?.col}
        data-nav-row={nav?.row}
        onKeyDown={nav ? handleGridNavKey : undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          if (raw === "") return onChange("");
          onChange(`${Math.max(0, Math.min(100, parseInt(raw, 10) || 0))}%`);
        }}
        className={`border-line focus:border-primary tabular bg-card h-8 w-12 border px-1 text-center text-sm font-bold outline-none disabled:opacity-40 ${radius}`}
      />
      <span className="text-text-faint text-xs">%</span>
      {/* 알약 2개는 **한 덩어리로** 접힌다 — 낱개로 두면 칸 폭이 1~2px 달라질 때마다 '미제출'만 남고
          '없음'이 내려가는 등 행마다 모양이 달라진다. 묶어 두면 "숫자 / 알약" 두 줄로 항상 같다. */}
      <span className="flex items-center gap-1">
        {/* 미제출 = **안 내왔다**(0%와 수행률은 같지만 학부모에게 나가는 문장이 다르다 — 원장 2026-08-03). */}
        <button
          type="button"
          onClick={() => onChange(isNotSubmitted ? "" : NOT_SUBMITTED)}
          aria-pressed={isNotSubmitted}
          title={t("os.hw.notSubmittedTitle")}
          className={chip(isNotSubmitted)}
        >
          {t("os.hw.notSubmitted")}
        </button>
        {/* 과제가 **없던 날** — 미제출과 다르다(내준 과제 자체가 없음). 다시 누르면 해제. */}
        <button
          type="button"
          onClick={() => onChange(isNone ? "" : NONE_LABEL)}
          aria-pressed={isNone}
          title={t("os.hw.noneTitle")}
          className={chip(isNone)}
        >
          {t("os.hw.none")}
        </button>
      </span>
    </div>
  );
}
