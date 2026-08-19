"use client";

/**
 * 출결 요약 탭(관리자용) — **결정론 집계만** 그린다. AI 정리 카드는 그 위에 얹히는 부가물이라
 * 없거나 실패해도 이 화면은 온전하다(원장 2026-08-19: *"팩트만을 가지고"*).
 *
 * 화면 순서 = 관리자가 손댈 순서다: ① 기간 종합 스탯 ② AI 정리(선택) ③ **날짜별 블록**
 * (결석 → 지각·조퇴·보강 → 미입력 출석부) ④ 기간 전체에서 입력이 덜 된 강사.
 * 숫자만 크게 띄우고 명단을 접지 않는다 — "결석 18건"만 보이고 누구인지 다음 화면에 있으면
 * 결국 아무도 안 본다.
 *
 * 🔑 월요일은 금·토·일 사흘을 덮는다(원장 정정) — 합계는 위에 한 번, 내용은 **날짜별로 나눠서**.
 */
import { EmptyState } from "@/components/empty-state";
import { BigStat } from "@/components/atoms/big-stat";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { formatKoreanDate } from "@/lib/date-kst";
import type { RangeRecap } from "@/features/attendance/recap/range";
import { RecapAiCard, type RecapAiState } from "./recap-ai-card";
import { RecapDayBlock } from "./recap-day";

export function RecapView({
  recap,
  isToday,
  ai,
}: {
  recap: RangeRecap;
  /** 오늘을 요약하면 아직 끝나지 않은 하루다 — 숫자가 확정이 아님을 화면이 먼저 말한다. */
  isToday: boolean;
  ai: RecapAiState;
}) {
  const t = recap.totals;
  const absentTotal = t.absent + t.excused;
  const otherTotal = t.late + t.earlyLeave + t.makeup;
  // 수업이 아예 없던 날은 블록을 만들지 않는다 — 일요일 빈 블록이 금·토 사이에 끼면 읽기만 어렵다.
  // (보강·특강이 실제로 있었다면 slots>0이라 블록으로 뜬다. 있는데 안 보이는 일은 없다.)
  const shown = recap.days.filter((d) => d.totals.slots > 0);
  const skipped = recap.days.filter((d) => d.totals.slots === 0);
  const behind = recap.teachers.filter((x) => x.cells > 0 && x.recorded < x.cells);

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={
          recap.days.length > 1
            ? `${formatKoreanDate(recap.from)} ~ ${formatKoreanDate(recap.to)} — 수업이 없습니다`
            : `${formatKoreanDate(recap.to)} — 수업이 없습니다`
        }
        description={
          recap.days.find((d) => d.holiday)
            ? "휴원일이라 확인할 출결이 없습니다."
            : "시간표에 열린 교시가 없어 요약할 출결이 없습니다."
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {isToday ? (
        <p className="bg-amber-soft text-amber-strong rounded-2xl px-3 py-2 text-[13px] font-medium">
          오늘은 아직 진행 중입니다 — 아래 숫자는 지금까지 입력된 것까지입니다.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BigStat
          label="결석·공결"
          value={absentTotal}
          unit="건"
          tone={t.absentPending > 0 ? "danger" : "green"}
          icon={<EyIcon name="userX" size={16} />}
          valueClass={absentTotal > 0 ? "text-danger" : undefined}
          sub={t.absentPending > 0 ? `조치 미완료 ${t.absentPending}건` : "모두 확인 완료"}
        />
        <BigStat
          label="지각·조퇴·보강"
          value={otherTotal}
          unit="건"
          tone="amber"
          icon={<EyIcon name="clock" size={16} />}
          sub={`지각 ${t.late} · 조퇴 ${t.earlyLeave} · 보강 ${t.makeup}`}
        />
        {/* ⚠️ 여러 날을 덮으면 같은 반이 금·토 각각 한 번씩 세어진다 — 그래서 단위가 '반'이 아니라
            '건'(그날 그 반의 출석부 하나)이다. 하루짜리에선 그대로 '반'. */}
        <BigStat
          label="출석부 미입력"
          value={t.unmarkedClasses}
          unit={recap.days.length > 1 ? "건" : "반"}
          tone={t.unmarkedClasses > 0 ? "amber" : "green"}
          icon={<EyIcon name="clipboardList" size={16} />}
          sub={t.unmarkedClasses > 0 ? `학생 ${t.unmarkedStudents}명이 기록 없음` : "전 반 입력 완료"}
        />
        {/* ⚠️ 기록이 0건이면 "0%"는 사실이 아니다 — 입력률이 0인 게 아니라 아무도 안 찍은 것이다
            (월간 출석부 LiveStats와 같은 규약). */}
        <BigStat
          label="출결 입력"
          value={t.inputRate ?? "—"}
          unit={t.inputRate == null ? "기록 없음" : "%"}
          tone={t.inputRate != null && t.inputRate >= 90 ? "green" : "amber"}
          icon={<EyIcon name="percent" size={16} />}
          sub={`${t.cells}칸 중 ${t.recorded}칸 · ${t.slots}교시`}
        />
      </section>

      <RecapAiCard from={recap.from} to={recap.to} state={ai} />

      {/* 빈 날은 블록 대신 한 줄 — "안 봤다"와 "볼 게 없었다"를 구분해 준다. */}
      {skipped.length > 0 ? (
        <p className="text-text-faint text-[12px]">
          {skipped
            .map((d) => `${formatKoreanDate(d.date)} ${d.holiday ? `휴원일(${d.holiday})` : "수업 없음"}`)
            .join(" · ")}
        </p>
      ) : null}

      <div className="space-y-6">
        {shown.map((day) => (
          <RecapDayBlock key={day.date} day={day} single={shown.length === 1} />
        ))}
      </div>

      {/* 강사는 날짜를 가로질러 합친다 — 사흘치를 날짜별로 흩으면 "누가 계속 안 찍나"가 안 보인다. */}
      {behind.length > 0 ? (
        <section className="space-y-2">
          <h2 className="flex items-baseline gap-2">
            <span className="text-sm font-bold">입력이 덜 된 강사</span>
            <span className="num text-text-dim text-sm">{behind.length}</span>
            {recap.days.length > 1 ? <span className="text-text-faint text-[11px]">기간 합계</span> : null}
          </h2>
          <ul className="bg-card shadow-card divide-line divide-y rounded-2xl">
            {behind.map((line) => (
              <li key={line.teacherName} className="flex items-center gap-x-2 px-3 py-2 text-sm">
                <span className="font-bold">{line.teacherName}</span>
                <span className="num text-text-dim ml-auto text-xs">
                  {line.cells}칸 중 {line.recorded}칸
                </span>
                {line.unmarkedClasses > 0 ? (
                  <span className="num text-amber-strong shrink-0 text-xs font-bold">
                    미입력 {line.unmarkedClasses}반
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
