"use client";

// 원스크린 "월간 발송" 뷰 — 내가 쓴 보고서의 발송 현황을 한 달 달력으로 보고, 날짜를 눌러 그날 상세를 편다.
// 숫자는 0127a group-by RPC 집계(B2), 버킷 판정은 순수 함수(send-calendar.ts), 날짜 상세는 기존
// HistoryBoard를 `date` 모드로 재사용한다(목록 렌더를 두 벌 만들지 않는다).
import { useEffect, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  defaultSelectedDay,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  summarizeSendDays,
  type SendDay,
} from "../send-calendar";
import { getMySendCalendar } from "../server/calendar-actions";
import { HistoryBoard } from "./history-board";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
/** 아직 못 불러온 달의 자리표시 — 매 렌더 새 Map을 만들면 자식이 불필요하게 다시 그려진다. */
const EMPTY_DAYS: Map<string, SendDay> = new Map();

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="text-text-faint inline-flex items-center gap-1 text-[11px]">
      <span className={`size-2 rounded-full ${tone}`} aria-hidden />
      {label}
    </span>
  );
}

/** 하루 칸의 내용 — 자료가 없으면 날짜만(빈 날을 숫자 0으로 채우면 눈이 시끄럽다). */
function DayCellBody({ day }: { day: SendDay | undefined }) {
  if (!day || day.total === 0) return null;
  const allSent = day.target > 0 && day.sent === day.target;
  return (
    <span className="mt-0.5 flex flex-col items-start gap-0.5">
      <span
        className={`tabular text-[11px] font-bold ${
          day.target === 0 ? "text-text-faint" : allSent ? "text-primary" : "text-text-dim"
        }`}
        // 분자·분모는 "학부모에게 나갔나"라는 **사실**이고(출처 무관), 아래 배지는 "지금 내가 누를 게
        // 있나"라는 **행동**이다. 둘을 한 숫자로 합치면 못 누르는 건까지 재촉하게 된다.
        title={
          `학부모 발송 ${day.sent} / 작성 ${day.target}건` +
          (day.actionable > 0
            ? ` · 지금 보낼 수 있는 건 ${day.actionable}건`
            : day.sent < day.target
              ? " · 남은 건은 지금 발송할 수 없습니다(옛 이관분·과목 설정·기한·결석 등)"
              : "")
        }
      >
        {day.sent}/{day.target}
      </span>
      {day.problem > 0 ? (
        <span className="bg-danger/10 text-danger rounded-pill px-1 text-[10px] font-bold">
          실패 {day.problem}
        </span>
      ) : day.actionable > 0 ? (
        // ⚠️ '미발송'이 아니라 '보낼 수 있음' — 미발송 전부를 재촉하면 옛 이관분까지 재촉하는 거짓말이 된다.
        <span className="bg-amber-soft text-amber rounded-pill px-1 text-[10px] font-bold">
          보낼 수 있음 {day.actionable}
        </span>
      ) : day.pending > 0 ? (
        <span className="text-text-faint text-[10px]">대기 {day.pending}</span>
      ) : null}
    </span>
  );
}

/**
 * 달력 ↔ 전체 목록 전환. 달력은 "언제 무엇이 밀렸나"를, 목록은 "이 학생 최근 보고서"를 본다 —
 * 달력이 목록을 대체하지 못하는 유일한 축이 **날짜를 가로지르는 학생 검색**이라 목록을 남겨 둔다.
 */
function ModeToggle({ mode, onMode }: { mode: "calendar" | "list"; onMode: (m: "calendar" | "list") => void }) {
  return (
    <div className="border-line flex items-center rounded-full border p-0.5">
      {(["calendar", "list"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onMode(m)}
          aria-pressed={mode === m}
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
            mode === m ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
          }`}
        >
          {m === "calendar" ? "달력" : "전체 목록"}
        </button>
      ))}
    </div>
  );
}

export function SendCalendarBoard({ todayYmd }: { todayYmd: string }) {
  const [mode, setMode] = useState<"calendar" | "list">("calendar");
  const [month, setMonth] = useState(() => monthOf(todayYmd));
  // ⚠️ 로드 결과에 **어느 달의 것인지**를 함께 담는다 — effect 안 동기 setState 금지(#25) 회피이자,
  // 다음 달을 불러오는 동안 지난 달 숫자를 새 달 머리글 밑에 띄우는 거짓말도 같이 막는다.
  const [loaded, setLoaded] = useState<{ month: string; days: Map<string, SendDay>; error: string | null }>({
    month: "",
    days: new Map(),
    error: null,
  });
  // ⚠️ 사용자가 직접 고른 날짜인지 기억한다 — 응답이 늦게 와서 기본 선택으로 덮으면
  // "내가 누른 날이 아닌 날"이 열린다(적대 검증 확정).
  const [selected, setSelected] = useState<string | null>(null);
  // ref인 이유: 이 값은 화면에 안 그려지고 effect의 판단에만 쓰인다. state로 두면 effect 의존성에 들어가
  // 사용자가 날짜를 누를 때마다 그 달을 다시 조회하게 된다.
  const pickedMonthRef = useRef<string | null>(null);

  const ready = loaded.month === month;
  const loading = !ready;
  const days = ready ? loaded.days : EMPTY_DAYS;
  const error = ready ? loaded.error : null;
  // 달을 넘기는 동안 지난 달 날짜가 상세에 남지 않게(그 날짜는 이 달 격자에 없다).
  const selectedInMonth = selected && monthOf(selected) === month ? selected : null;

  useEffect(() => {
    // 달이 바뀔 때마다 다시 읽는다. 늦게 온 이전 달 응답이 새 달을 덮지 않게 취소 플래그.
    let cancelled = false;
    void getMySendCalendar({ month }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const next = summarizeSendDays(res.rows ?? []);
        setLoaded({ month, days: next, error: null });
        // 달을 열면 자료 있는 날이 바로 펼쳐진다(오늘 우선 → 없으면 가장 최근).
        // 단 사용자가 이 달에서 이미 날짜를 골랐다면 그 선택을 존중한다.
        setSelected((cur) => (pickedMonthRef.current === month && cur ? cur : defaultSelectedDay(next, todayYmd)));
      } else {
        setLoaded({ month, days: new Map(), error: res.error ?? "달력을 불러오지 못했습니다" });
        setSelected(null);
      }
    }).catch(() => {
      // ⚠️ .catch가 없으면 reject 시 loaded.month가 영영 안 바뀌어 화면이 '불러오는 중…'에 갇힌다.
      if (cancelled) return;
      setLoaded({ month, days: new Map(), error: "달력을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" });
      setSelected(null);
    });
    return () => {
      cancelled = true;
    };
  }, [month, todayYmd]);

  const weeks = monthGrid(month);
  // 달 요약 — 칸을 다 훑지 않아도 이 달이 어땠는지 한 줄로.
  const sum = [...days.values()].reduce(
    (a, d) => ({
      total: a.total + d.total,
      sent: a.sent + d.sent,
      target: a.target + d.target,
      problem: a.problem + d.problem,
      actionable: a.actionable + d.actionable,
    }),
    { total: 0, sent: 0, target: 0, problem: 0, actionable: 0 },
  );
  const isThisMonth = month === monthOf(todayYmd);

  if (mode === "list") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <ModeToggle mode={mode} onMode={setMode} />
        </div>
        <HistoryBoard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="bg-card border-line shadow-card rounded-2xl border">
        <header className="border-line flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label="이전 달"
              className="text-text-dim hover:bg-bg-soft rounded-full px-1 py-1"
            >
              <EyIcon name="chevronLeft" size={16} />
            </button>
            <h3 className="text-foreground min-w-[92px] text-center text-[13px] font-bold">
              {monthLabel(month)}
            </h3>
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              aria-label="다음 달"
              className="text-text-dim hover:bg-bg-soft rounded-full px-1 py-1"
            >
              <EyIcon name="chevronRight" size={16} />
            </button>
          </div>
          {!isThisMonth ? (
            <button
              type="button"
              onClick={() => setMonth(monthOf(todayYmd))}
              className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2 py-1 text-[11px] font-bold"
            >
              이번 달
            </button>
          ) : null}
          {loading ? (
            <span className="text-text-faint text-[12px]">불러오는 중…</span>
          ) : error ? (
            <span className="text-danger text-[12px]">{error}</span>
          ) : (
            <span className="text-text-faint text-[12px]">
              작성 {sum.total}건 · 학부모 발송 {sum.sent}/{sum.target}
              {sum.actionable > 0 ? (
                <span className="text-amber font-bold"> · 보낼 수 있음 {sum.actionable}</span>
              ) : null}
              {sum.problem > 0 ? (
                <span className="text-danger font-bold"> · 실패 {sum.problem}</span>
              ) : null}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Legend tone="bg-primary" label="전부 발송" />
            <Legend tone="bg-amber" label="보낼 수 있음" />
            <Legend tone="bg-danger" label="실패 있음" />
            <ModeToggle mode={mode} onMode={setMode} />
          </span>
        </header>

        <div className="px-2 pt-1.5 pb-2">
          <div className="grid grid-cols-7">
            {WEEKDAY.map((w, i) => (
              <div
                key={w}
                className={`pb-1 text-center text-[11px] font-bold ${
                  i === 0 ? "text-danger" : "text-text-faint"
                }`}
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weeks.flat().map((date, i) => {
              if (!date) return <div key={`pad-${i}`} aria-hidden />;
              const day = days.get(date);
              const isSel = date === selectedInMonth;
              const isToday = date === todayYmd;
              const hasData = !!day && day.total > 0;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => {
                    setSelected(date);
                    pickedMonthRef.current = month;
                  }}
                  aria-pressed={isSel}
                  // 자료 없는 날도 누를 수 있게 둔다 — "정말 아무것도 안 썼는지" 확인하는 것도 답이다.
                  className={`flex min-h-[54px] flex-col items-start rounded-lg border px-1.5 py-1 text-left transition ${
                    isSel
                      ? "border-primary bg-primary-soft"
                      : hasData
                        ? "border-line hover:bg-bg-soft"
                        : "border-transparent hover:bg-bg-soft"
                  }`}
                >
                  <span
                    className={`tabular text-[11px] ${
                      isToday ? "text-primary font-bold" : hasData ? "text-foreground font-bold" : "text-text-faint"
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>
                  <DayCellBody day={day} />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 선택한 날짜 상세 — 목록 렌더는 "지난 보고서"와 같은 컴포넌트(규약 갈라짐 방지). */}
      {selectedInMonth ? (
        <HistoryBoard key={selectedInMonth} date={selectedInMonth} />
      ) : (
        <div
          className={`bg-card border-line shadow-card flex items-center justify-center rounded-2xl border p-10 text-sm ${
            error ? "text-danger" : "text-text-faint"
          }`}
        >
          {/* ⚠️ 조회 실패를 "작성 0건"으로 보고하면 안 된다 — 실패와 빈 달은 다른 사실이다. */}
          {loading ? "불러오는 중…" : error ? error : "이 달에 작성한 보고서가 없습니다"}
        </div>
      )}
    </div>
  );
}
