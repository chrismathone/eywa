"use client";

/**
 * 오늘 보드 상단 **하루 요약 스트립** — 원스크린 상단 마감 통계(학생·진도·발송 N/N)에 대응하는
 * 영어 강사 홈의 "오늘 어디까지 왔나" 한 줄. 카드 배지의 합산이라 서버 쿼리 추가 0.
 *
 * 색 규약은 카드 배지와 동일 — **못 한 일에만 앰버**, 다 한 줄은 무채색(눈이 갈 곳을 지킨다).
 * 글씨 크기 토글은 주간 시트 툴바와 같은 어휘(작음/보통/큼)·같은 계정 귀속(users.ui_prefs.ecs.fontSize).
 */
import {
  ECS_FONT_SIZES,
  ECS_FONT_SIZE_LABEL,
  type EcsFontSize,
} from "../font-size";

export type TodayStats = {
  classes: number;
  plan: { filled: number; total: number };
  att: { marked: number; total: number };
  report: { written: number; total: number };
  /** ClassNote 반 알림장 게시(반 단위) — 영어 발송의 실제 채널(0140a). */
  classnote: { posted: number; total: number };
};

function Stat({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="micro">{label}</span>
      <span className={`num text-[14px] font-bold ${done ? "text-text-dim" : "text-amber"}`}>{value}</span>
    </span>
  );
}

export function TodaySummary({
  stats,
  fontSize,
  onFontSize,
  holiday = false,
}: {
  stats: TodayStats;
  fontSize: EcsFontSize;
  onFontSize: (s: EcsFontSize) => void;
  /**
   * 학원 휴일인가 — **색만** 걷는다(숫자는 그대로 보인다).
   * 🔴 휴일엔 쓸 의무가 없으므로 "계획 0/6"을 앰버로 세우면 고칠 것이 없는 일을 재촉하는 거짓 신호다
   *    ([`holiday.ts`](../lib/holiday.ts) 규약 — 안 쓴 휴일은 작성률 분모에도 안 들어간다).
   * ⚠️ 숫자를 감추거나 0으로 만들지 않는다 — 그날 실제로 수업했다면 그 진행이 그대로 보여야 한다.
   */
  holiday?: boolean;
}) {
  // `done` = "재촉하지 않는다". 휴일이면 무엇을 얼마나 했든 재촉할 일이 없다.
  const done = (ok: boolean) => holiday || ok;
  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl px-4 py-2.5">
      <Stat label="수업" value={`${stats.classes}개`} done />
      <Stat label="계획" value={`${stats.plan.filled}/${stats.plan.total}`} done={done(stats.plan.filled >= stats.plan.total)} />
      <Stat label="출결" value={`${stats.att.marked}/${stats.att.total}`} done={done(stats.att.marked >= stats.att.total)} />
      <Stat label="보고서" value={`${stats.report.written}/${stats.report.total}`} done={done(stats.report.written >= stats.report.total)} />
      {/* 분모 = ClassNote 보드가 확인된 반만 — 0/0(연동 반 없음)이면 숫자 자체를 안 그린다. */}
      {stats.classnote.total > 0 ? (
        <Stat label="알림장" value={`${stats.classnote.posted}/${stats.classnote.total}반`} done={done(stats.classnote.posted >= stats.classnote.total)} />
      ) : null}
      {/* 글씨 크기 — 주간 시트 툴바와 같은 3칩(aria-pressed). 저장은 부모가 한다(낙관 적용 + 계정 저장). */}
      <span className="ml-auto flex items-center gap-0.5">
        <span className="micro mr-0.5">글씨</span>
        {ECS_FONT_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={fontSize === s}
            onClick={() => onFontSize(s)}
            className={`cursor-pointer rounded-full px-2 py-0.5 text-[12px] font-bold transition ${
              fontSize === s ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-bg-soft"
            }`}
          >
            {ECS_FONT_SIZE_LABEL[s]}
          </button>
        ))}
      </span>
    </div>
  );
}
