"use client";

/**
 * 일괄 입력 팝오버의 **추가 칸**(원장 2026-10-02 *"일괄 입력에 지금 없는거 추가"*) — 표 행에는 있는데 일괄 입력엔 없던 것:
 * 일일·확인 테스트 · 지난 영상 숙제 검사 · 오늘 영상 과제(+ 영상 첨부 링크 넣기) · 특이사항.
 * 상태는 팝오버(bulk-apply.tsx)가 들고, 여기는 그리기만 한다(그 파일이 더 커지지 않게 갈랐다).
 *
 * ⚠️ 타임(시수)은 여기 없다 — 이미 '출결'과 함께 들어간다(새 기록에만). 찍혀 있는 기록의 시수를 일괄로 바꾸는 길은
 *    급여 재료를 한 번에 덮는 길이라 열지 않았다. 학부모 문구·학습 추세는 학생마다 다른 글이라 일괄 대상이 아니다.
 */
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";

/** 팝오버가 그릴 칸을 정하는 재료 — 표 설정 + 대상 행 가운데 영상 칸이 있는 행 수(0이면 그 줄을 안 그린다). */
export type BulkFieldConfig = {
  attitudes: readonly string[];
  dailyEnabled: boolean;
  checkEnabled: boolean;
  /** 강사가 문항수를 바꿀 수 있나(학원 설정) — 꺼져 있으면 문항수 칸이 없다. */
  allowTestMax: boolean;
  /** '영상 과제' 토글이 있는 행 수. */
  videoRows: number;
  /** '영상 첨부 링크 넣기'를 고를 수 있는 행 수. */
  linkRows: number;
  /** 지난 영상 숙제 검사 칸이 있는 행 수 — 읽기 전용 화면이면 0. */
  videoCheckRows: number;
  /**
   * 고른 검사의 실제 대상 — 찍을 칸 수와 그중 **이미 찍힌 기록을 바꾸는** 칸 수(순수 계산, planBulkVideoCheck).
   * 검사는 적용 즉시 기록되고 '미제출'은 적어 둔 제출일까지 지우므로, 바꾸는 칸이 있으면 적용 전에 밝힌다(출결과 같은 규칙).
   */
  videoCheckPlan?: (status: VideoHomeworkStatus, onlyEmpty: boolean) => BulkVideoCheckPlan;
};
export type BulkVideoCheckPlan = { cells: number; overwrite: number };

export type BulkTestState = { dailyScore: string; dailyMax: string; checkScore: string; checkMax: string };
export const EMPTY_BULK_TESTS: BulkTestState = { dailyScore: "", dailyMax: "", checkScore: "", checkMax: "" };

/** 숫자 칸 값 → 숫자(빈칸·숫자 아님 = 적용 안 함). */
export const bulkCount = (raw: string): number | undefined => {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return undefined;
  return Number(text);
};

const NUM = "border-line bg-card focus:border-primary h-8 w-14 rounded-lg border px-2 text-center text-xs outline-none";
const pill = (on: boolean) =>
  `rounded-pill px-2 py-0.5 text-xs font-bold transition ${
    on ? "bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft border"}`;

/** 일일·확인 테스트 — 맞은 개수 / 문항수. 켜진 테스트만 그린다. */
export function BulkTestFields({ config, value, onChange }: {
  config: Pick<BulkFieldConfig, "dailyEnabled" | "checkEnabled" | "allowTestMax">;
  value: BulkTestState;
  onChange: (next: BulkTestState) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const rows = [
    config.dailyEnabled ? { which: "daily" as const, label: t("os.col.daily") } : null,
    config.checkEnabled ? { which: "check" as const, label: t("os.col.check") } : null,
  ].filter((row) => row !== null);
  if (!rows.length) return null;
  const digits = (raw: string) => raw.replace(/\D/g, "").slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {rows.map(({ which, label }) => (
        <div key={which} className="flex items-center gap-1">
          <span className="micro text-text-faint">{label}</span>
          <input inputMode="numeric" value={value[`${which}Score`]} placeholder={t("os.bulk.scorePh")}
            onChange={(e) => onChange({ ...value, [`${which}Score`]: digits(e.target.value) })}
            aria-label={tf("os.bulk.scoreAria", { label })} className={NUM} />
          {config.allowTestMax ? (
            <>
              <span className="text-text-faint text-xs">/</span>
              <input inputMode="numeric" value={value[`${which}Max`]} placeholder={t("os.bulk.maxPh")}
                onChange={(e) => onChange({ ...value, [`${which}Max`]: digits(e.target.value) })}
                aria-label={tf("os.bulk.maxAria", { label })} className={NUM} />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export type BulkVideoState = {
  /** 지난 영상 숙제 검사 — null = 적용 안 함. 🔴 적용 즉시 기록된다(출결과 같은 성질). */
  check: VideoHomeworkStatus | null;
  /** 오늘 영상 과제 — null = 적용 안 함. */
  homework: boolean | null;
  /** 영상 첨부 링크 넣기 — '있음'을 고른 때만 뜻이 있다. */
  link: boolean;
};
export const EMPTY_BULK_VIDEO: BulkVideoState = { check: null, homework: null, link: false };

/** 영상 — 지난 숙제 검사(✓/✕) + 오늘 영상 과제(있음/없음) + 영상 첨부 링크 넣기. 대상 행이 없는 줄은 그리지 않는다. */
export function BulkVideoFields({ config, value, onChange, checkPlan = null }: {
  config: Pick<BulkFieldConfig, "videoRows" | "linkRows" | "videoCheckRows">;
  value: BulkVideoState;
  onChange: (next: BulkVideoState) => void;
  /** 고른 검사의 대상(찍을 칸·바꾸는 칸) — 고르는 즉시 보여 준다(눌러 보고 나서 알면 늦다). */
  checkPlan?: BulkVideoCheckPlan | null;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  if (!config.videoRows && !config.videoCheckRows) return null;
  const checks: { value: VideoHomeworkStatus; label: string; icon: "check" | "close" }[] = [
    { value: "submitted", label: t("os.vh.done"), icon: "check" },
    { value: "missing", label: t("os.vh.missing"), icon: "close" },
  ];
  return (
    <div className="border-line bg-bg-soft/60 flex flex-col gap-1.5 rounded-md border p-2">
      <p className="micro text-text-faint inline-flex items-center gap-1">
        <EyIcon name="play" size={12} aria-hidden />
        {t("os.bulk.videoTitle")}
      </p>
      {config.videoCheckRows ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-text-dim mr-1 text-xs">{t("os.bulk.videoCheck")}</span>
          <button type="button" onClick={() => onChange({ ...value, check: null })} aria-pressed={value.check === null} className={pill(value.check === null)}>
            {t("os.bulk.attNone")}
          </button>
          {checks.map((option) => (
            <button key={option.value} type="button" aria-pressed={value.check === option.value}
              onClick={() => onChange({ ...value, check: value.check === option.value ? null : option.value })}
              className={`${pill(value.check === option.value)} inline-flex items-center gap-0.5`}>
              <EyIcon name={option.icon} size={12} aria-hidden />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {config.videoRows ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-text-dim mr-1 text-xs">{t("os.bulk.videoHw")}</span>
          <button type="button" onClick={() => onChange({ ...value, homework: null, link: false })} aria-pressed={value.homework === null} className={pill(value.homework === null)}>
            {t("os.bulk.attNone")}
          </button>
          {([true, false] as const).map((on) => (
            <button key={String(on)} type="button" aria-pressed={value.homework === on}
              onClick={() => onChange(value.homework === on ? { ...value, homework: null, link: false } : { ...value, homework: on, link: on ? value.link : false })}
              className={pill(value.homework === on)}>
              {on ? t("os.bulk.videoHwOn") : t("os.bulk.videoHwOff")}
            </button>
          ))}
        </div>
      ) : null}
      {/* 영상 첨부 링크 넣기 — '있음'을 고른 때만 뜬다(행의 토글과 같은 흐름: 영상 과제를 켜야 링크 토글이 생긴다). */}
      {config.videoRows && config.linkRows && value.homework === true ? (
        <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-xs" title={t("os.row.videoLinkTip")}>
          <input type="checkbox" checked={value.link} onChange={() => onChange({ ...value, link: !value.link })} className="accent-primary size-3.5" />
          {t("os.row.videoLink")}
        </label>
      ) : null}
      {value.check && checkPlan ? (
        <p className={`text-xs ${checkPlan.cells ? "text-text-dim" : "text-amber"}`}>
          {checkPlan.cells ? (
            <>
              <span className="text-foreground font-bold">{checkPlan.cells}</span>
              {t("os.bulk.planRecord")}
              {checkPlan.overwrite ? tf("os.bulk.planOver", { n: checkPlan.overwrite }) : ""}
            </>
          ) : (
            t("os.bulk.planNone")
          )}
        </p>
      ) : null}
      <p className="text-text-faint text-xs">
        {config.videoRows ? t("os.bulk.videoRows") : null}
        {config.videoRows && config.videoCheckRows ? " · " : null}
        {config.videoCheckRows ? t("os.bulk.videoCheckHint") : null}
      </p>
    </div>
  );
}
