"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { TOOLBAR_SEARCH_BOX } from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { useResultToast } from "@/components/action-toast";
import { addLeaveAdjustment, deleteLeaveAdjustment } from "@/features/leave/server/actions";
import type { LeaveActionState } from "@/features/leave/action-state";
import type { LeaveOverviewRow } from "@/features/leave/server/admin";
import { leavePeriodLabel } from "@/features/leave/accrual";
import {
  deltaForTotal,
  formatSignedDays,
  grantedTotal,
  MAX_LEAVE_DELTA,
  MAX_LEAVE_TOTAL,
  roundDays,
} from "@/features/leave/balance";
import { countLeaveDays, formatLeaveDays } from "@/features/leave/request-days";
import { maxUsedEnd, usedRangeLabel } from "@/features/leave/used-range";

/**
 * 연차 관리 표(직원관리) — 직원별 부여·조정·사용·잔여를 한 줄로 보고, 그 자리에서 **조정 창**을 연다
 * (원장 2026-09-08: *"관리자랑 김예원이 직원들의 연차갯수를 조정해야하는데 해당 기능이 없음"* /
 *  2026-09-09: *"직원관리에 버튼 연동해주지"*).
 *
 * 🔑 입력 방식이 둘인 이유: 사무실이 실제로 말하는 건 *"이 사람 연차 18개로 해줘"*(총 부여)인데,
 *    이월·특별휴가처럼 *"3일 더"*(가감)로 말할 때도 있다. 화면이 둘 다 받고 **저장은 언제나 가감
 *    한 줄**이다 — 총 일수를 그대로 덮어쓰면 왜 바뀌었는지가 사라진다(0252a 머리주석).
 * ⚠️ 미리보기 숫자는 화면 계산일 뿐 판정이 아니다 — 서버가 저장 직전에 다시 계산한다(그 사이 다른
 *    관리자가 조정했을 수 있다).
 */

/** 표 열 — 열 제목과 값은 같은 축(원장 2026-09-18). 글 칸은 가운데, 숫자 칸은 제목까지 우측으로 모아 자릿수를 맞춘다. */
const NUM_CELL = "num px-2.5 py-2 text-right";

type Props = {
  rows: LeaveOverviewRow[];
  /** 0252a 미적용이면 조정 버튼을 잠근다(표는 그대로 읽힌다). */
  tableReady: boolean;
  /**
   * 사용 기간 칸(0270b)이 있나 — 없으면 **기간 입력만** 잠근다(일수·사유는 그대로 쓴다).
   * 🔴 조정 기능 전체를 잠그지 않는다 — 칸 하나가 없다고 되는 일까지 막으면 안 된다([[#95]]).
   */
  usedRangeReady: boolean;
  /**
   * 읽기 강사뷰(원장이 조정 담당 직원의 화면을 '읽기'로 연 경우) — 표는 보이고 '조정' 단추는 그리지 않는다(쓰기 단추는 그리지 않는다 —
   * write-lock.ts 규칙). 저장 액션도 같은 판정으로 거절한다(readonlyTeacherViewError).
   */
  readOnly?: boolean;
};

export function AdjustTable({ rows, tableReady, usedRangeReady, readOnly = false }: Props) {
  const [query, setQuery] = useState("");
  const [openFor, setOpenFor] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.jobTitle ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const adjusted = rows.filter((r) => r.adjustment !== 0).length;
  const target = rows.find((r) => r.userId === openFor) ?? null;

  return (
    <>
      <Toolbar>
        <label className={`${TOOLBAR_SEARCH_BOX} w-52`}>
          <span className="sr-only">직원 검색</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·직급 검색"
            className="text-foreground placeholder:text-text-faint w-full bg-transparent outline-none"
          />
        </label>
        <span className="text-text-dim text-xs">
          직원 <span className="num">{filtered.length}</span>명 · 조정 있음{" "}
          <span className="num">{adjusted}</span>명
        </span>
      </Toolbar>

      <DragScrollArea className="border-line bg-card rounded-2xl border">
        <table className="w-full min-w-[860px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
          <thead>
            <tr className="border-line text-text-dim border-b text-center text-xs">
              <th className="px-2.5 py-2 font-semibold">이름</th>
              <th className="px-2.5 py-2 font-semibold">직급</th>
              <th className="px-2.5 py-2 font-semibold">입사일</th>
              <th className="px-2.5 py-2 font-semibold">연차 구간</th>
              <th className="px-2.5 py-2 text-right font-semibold">법정 부여</th>
              <th className="px-2.5 py-2 text-right font-semibold">조정</th>
              <th className="px-2.5 py-2 text-right font-semibold">총 부여</th>
              <th className="px-2.5 py-2 text-right font-semibold">사용</th>
              <th className="px-2.5 py-2 text-right font-semibold">결재중</th>
              <th className="px-2.5 py-2 text-right font-semibold">잔여</th>
              <th className="px-2.5 py-2 font-semibold">조정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.userId} className="border-line/60 border-b last:border-b-0">
                <td className="px-2.5 py-2 text-center font-semibold whitespace-nowrap">{r.name}</td>
                <td className="text-text-dim px-2.5 py-2 text-center whitespace-nowrap">{r.jobTitle ?? "—"}</td>
                <td className="text-text-dim px-2.5 py-2 text-center whitespace-nowrap">
                  <span className="num">{r.hireDate ?? "미등록"}</span>
                </td>
                {r.period ? (
                  <>
                    <td className="text-text-dim px-2.5 py-2 text-center text-xs whitespace-nowrap">
                      <span className="num">{leavePeriodLabel(r.period)}</span>
                      <span className="ml-1.5">{r.period.label}</span>
                    </td>
                    <td className={`${NUM_CELL} text-text-dim`}>{formatLeaveDays(r.legalGranted)}</td>
                    <td
                      className={`${NUM_CELL} font-semibold ${
                        r.adjustment > 0 ? "text-green" : r.adjustment < 0 ? "text-danger" : "text-text-faint"
                      }`}
                    >
                      {r.adjustment === 0 ? "—" : formatSignedDays(r.adjustment)}
                    </td>
                    <td className={`${NUM_CELL} font-bold`}>{formatLeaveDays(r.granted)}</td>
                    <td className={`${NUM_CELL} text-text-dim`}>{formatLeaveDays(r.used)}</td>
                    <td className={`${NUM_CELL} text-text-dim`}>{formatLeaveDays(r.pending)}</td>
                    <td
                      className={`${NUM_CELL} font-bold ${r.remaining > 0 ? "text-foreground" : "text-danger"}`}
                    >
                      {formatLeaveDays(r.remaining)}
                    </td>
                  </>
                ) : (
                  <td
                    colSpan={7}
                    className="text-text-faint px-2.5 py-2 text-xs break-keep"
                    // 입사일이 없으면 구간이 없어 부여·잔여가 아예 성립하지 않는다 — 0으로 채우면
                    // "연차가 0일"이라는 거짓 사실이 된다.
                  >
                    입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 직원관리에서 입사일을 먼저 등록하세요.
                  </td>
                )}
                <td className="px-2.5 py-2 text-center">
                  {readOnly ? null : <button
                    type="button"
                    disabled={!r.period || !tableReady}
                    onClick={() => setOpenFor(r.userId)}
                    className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft rounded-md border px-2 py-1 text-xs font-semibold transition disabled:opacity-40"
                    title={
                      !tableReady
                        ? "연차 조정 표(0252a)가 아직 준비되지 않았습니다"
                        : !r.period
                          ? "입사일이 없어 조정할 수 없습니다"
                          : `${r.name} 연차 조정`
                    }
                  >
                    조정
                  </button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-text-faint px-2.5 py-8 text-center text-sm">
                  검색 결과가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DragScrollArea>

      {target ? (
        <AdjustDialog
          row={target}
          usedRangeReady={usedRangeReady}
          open
          onClose={() => setOpenFor(null)}
        />
      ) : null}
    </>
  );
}

/**
 * 조정 확정 버튼.
 * 🔴 `blocked`를 반드시 받는다 — 미리보기만 빨갛게 두고 버튼을 열어 두면, 사유만 적고 엔터를 친 순간
 *    '총 부여를 지정' 모드의 빈 칸이 **총 0일**로 저장된다(적대 리뷰 2026-09-08). 서버도 같은 값을
 *    거절하지만, 되돌릴 수 없는 값이라 두 겹으로 막는다.
 */
function SubmitButton({ label, blocked }: { label: string; blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/** 조정 취소(삭제) 확정 버튼 — 제출 중엔 잠긴다(두 번 눌러 같은 행을 두 번 지우지 않게). */
function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-danger hover:text-danger/80 font-bold transition disabled:opacity-50"
    >
      {pending ? "지우는 중…" : "지우기"}
    </button>
  );
}

type Mode = "delta" | "total";

const MODE_META: Record<Mode, { label: string; hint: string; placeholder: string }> = {
  delta: {
    label: "가감",
    hint: "지금 일수에 더하거나(+) 뺍니다(−). 이월·특별휴가에 씁니다.",
    placeholder: "예: 3  또는  -1.5",
  },
  total: {
    label: "총 부여를 지정",
    hint: "총 부여 일수를 직접 정합니다 — 지금 값과의 차이가 조정으로 기록됩니다.",
    placeholder: "예: 18",
  },
};

function AdjustDialog({
  row,
  usedRangeReady,
  open,
  onClose,
}: {
  row: LeaveOverviewRow;
  usedRangeReady: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState<LeaveActionState, FormData>(addLeaveAdjustment, undefined);
  const [delState, delAction] = useActionState<LeaveActionState, FormData>(
    deleteLeaveAdjustment,
    undefined,
  );
  const [mode, setMode] = useState<Mode>("delta");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [usedStart, setUsedStart] = useState("");
  const [usedEnd, setUsedEnd] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 성공하면 창을 닫고 입력을 비운다 — 안 비우면 다음에 그 사람을 다시 열었을 때 지난 값이 남는다
  // (사용 기간은 특히 위험하다 — 남은 날짜가 다음 사람 차감에 그대로 붙는다).
  useResultToast(state, () => {
    setDays("");
    setReason("");
    setUsedStart("");
    setUsedEnd("");
    onClose();
  });
  useResultToast(delState, () => setConfirmId(null));

  const typed = days.trim();
  // ⚠️ `Number("")`는 0이다 — 빈 칸을 먼저 걸러야 '총 부여를 지정'에서 0으로 읽히지 않는다.
  const raw = Number(typed);
  const valid = typed !== "" && Number.isFinite(raw);
  /** 입력 문자열 → 실제로 기록될 가감. 칸을 고치는 **그 순간**에도 같은 식을 써야 날짜 칸이 어긋나지 않는다. */
  const deltaOf = (input: string) => {
    const t = input.trim();
    const n = Number(t);
    if (t === "" || !Number.isFinite(n)) return 0;
    return mode === "total" ? deltaForTotal(roundDays(n), row.granted) : roundDays(n);
  };
  /** 그 가감이 차지하는 **연차 사용일 수** — 반차(0.5)·반반차(0.25)는 하루로 올려 센다. */
  const neededOf = (d: number) => (d === 0 ? 0 : Math.max(1, Math.ceil(Math.abs(d))));
  const delta = deltaOf(days);
  const nextTotal = grantedTotal(row.legalGranted, roundDays(row.adjustment + delta));
  const quarterOk = !valid || Math.round(raw * 100) % 25 === 0;
  // 이미 쓴·결재중인 일수 아래로는 못 내린다(서버와 같은 판정 — 화면은 미리 알려 주기만 한다).
  const reserved = roundDays(row.used + row.pending);
  const belowUsed = valid && nextTotal < reserved;
  // 상한도 화면에서 먼저 알린다 — 미리보기가 "총 500일"을 정상처럼 보여 주고 서버만 거절하면
  // 그 미리보기는 거짓말이다(적대 리뷰 2026-09-08). 상수는 서버와 **같은 것**을 읽는다.
  const overCap = valid && (nextTotal > MAX_LEAVE_TOTAL || Math.abs(delta) > MAX_LEAVE_DELTA);
  // '총 부여를 지정'에 음수를 넣으면 grantedTotal이 0으로 잘려 belowUsed(0 < 0)에 안 걸린다 —
  // 미리보기가 "총 0일"을 정상 결과처럼 보여 주지 않게 여기서 따로 잡는다(적대 리뷰 2026-09-08).
  const negativeTotal = valid && mode === "total" && roundDays(raw) < 0;
  // 사용 기간은 **그 구간 안**에서만, 그리고 끝이 시작보다 앞설 수 없다 — 서버와 같은 판정이고
  // 화면은 미리 알려 주기만 한다([[#77]]). 시작 없이 끝만 적은 것도 막는다(DB 제약과 같은 뜻).
  const period = row.period;
  const outsidePeriod =
    !!period && [usedStart, usedEnd].filter(Boolean).some((d) => d < period.start || d > period.end);
  const reversed = !!usedStart && !!usedEnd && usedEnd < usedStart;
  const endWithoutStart = !usedStart && !!usedEnd;
  const usedRangeBad = outsidePeriod || reversed || endWithoutStart;
  // 가감 일수와 기간 길이가 맞는지 — **경고만** 한다(반차·반반차가 섞이면 정확히 안 맞는 게 정상이다).
  // 일수 계산은 휴가 신청과 **같은 순수 함수**(일요일 제외)라 두 화면이 같은 숫자를 말한다.
  const rangeDays = usedStart && !usedRangeBad ? countLeaveDays(usedStart, usedEnd || usedStart, "annual") : 0;
  const rangeMismatch = valid && delta < 0 && !!usedStart && !usedRangeBad && rangeDays !== Math.abs(delta);
  // 종료일 **상한** = 그 가감이 닿는 마지막 날(원장 2026-09-21: *"-4일이면 … 해당 일로부터 4일 까지"*).
  // 연차 구간 끝은 넘지 못하니 둘 중 이른 날이 달력의 max가 된다.
  const neededDays = neededOf(delta);
  const endLimit = usedStart && neededDays ? maxUsedEnd(usedStart, neededDays) : null;
  const endMax = [endLimit, row.period?.end].filter((v): v is string => !!v).sort()[0];
  // 🔴 제출 차단 조건은 **한 이름**으로 모은다 — 버튼 속성에 길게 늘어놓으면 조건을 더할 때
  //    미리보기만 고치고 버튼을 빼먹는다(2026-09-08 적대 리뷰가 잡은 자리와 같은 함정).
  // 🔴 사유는 **차단 조건이 아니다**(원장 2026-09-21: *"사유없어도 조정기록 되게해줘"*) — 다시 넣지 말 것.
  const blocked =
    !valid || !quarterOk || negativeTotal || delta === 0 || belowUsed || overCap || usedRangeBad;

  /**
   * 시작일을 고르면 종료일을 **그 가감에 맞게** 맞춘다(원장 2026-09-21).
   * 🔑 하루짜리(1일·반차·반반차)면 종료도 그날로 **자동** — 한 번 더 고르게 하지 않는다.
   * ⚠️ 상한을 넘겨 남아 있던 종료일은 상한으로 당기고, 시작보다 앞선 값은 비운다(거꾸로 된 기간 방지).
   */
  function pickStart(v: string) {
    setUsedStart(v);
    if (!v) {
      setUsedEnd("");
      return;
    }
    if (neededDays <= 1) {
      setUsedEnd(v);
      return;
    }
    const limit = maxUsedEnd(v, neededDays);
    setUsedEnd((prev) => (!prev || prev < v ? "" : prev > limit ? limit : prev));
  }

  /** 일수를 고치면 종료일이 **새 상한**을 넘지 않게 당긴다 — 하루짜리가 되면 시작일로 맞춘다. */
  function pickDays(v: string) {
    setDays(v);
    if (!usedStart) return;
    const need = neededOf(deltaOf(v));
    if (need <= 1) {
      setUsedEnd(usedStart);
      return;
    }
    const limit = maxUsedEnd(usedStart, need);
    setUsedEnd((prev) => (prev && prev > limit ? limit : prev));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.name} 연차 조정</DialogTitle>
        </DialogHeader>

        <div className="border-line bg-bg-soft/50 text-text-dim rounded-xl border px-3 py-2 text-xs break-keep">
          <p>
            <span className="num">{row.period ? leavePeriodLabel(row.period) : "—"}</span>
            {row.period ? ` · ${row.period.label}` : null}
          </p>
          <p className="mt-1">
            법정 <span className="num">{formatLeaveDays(row.legalGranted)}</span>
            {row.adjustment !== 0 ? (
              <>
                {" "}
                · 조정 <span className="num">{formatSignedDays(row.adjustment)}</span>
              </>
            ) : null}{" "}
            → 총 <b className="text-foreground num">{formatLeaveDays(row.granted)}</b> · 사용{" "}
            <span className="num">{formatLeaveDays(row.used)}</span> · 결재중{" "}
            <span className="num">{formatLeaveDays(row.pending)}</span> · 잔여{" "}
            <b className="text-foreground num">{formatLeaveDays(row.remaining)}</b>
          </p>
          {row.period?.monthly ? (
            // 입사 1년 미만은 부여가 매달 1일씩 늘어난다 — "총 N일로" 지정해도 다음 달엔 N+1이 된다.
            <p className="text-text-faint mt-1">
              입사 1년 미만이라 법정 부여가 매달 1일씩(최대 11일) 늘어납니다 — 총 일수도 함께
              늘어납니다.
            </p>
          ) : null}
        </div>

        <form action={action} className="space-y-3">
          <input type="hidden" name="userId" value={row.userId} />
          <input type="hidden" name="mode" value={mode} />

          <div className="flex flex-wrap items-center gap-2">
            <ToolbarSegment label="방식">
              {(Object.keys(MODE_META) as Mode[]).map((m) => (
                <ToolbarSegmentItem key={m} active={mode === m} onClick={() => setMode(m)}>
                  {MODE_META[m].label}
                </ToolbarSegmentItem>
              ))}
            </ToolbarSegment>
          </div>
          <p className="text-text-faint text-xs break-keep">{MODE_META[mode].hint}</p>

          <label className="block space-y-1">
            <span className="text-text-dim text-xs font-semibold">
              {mode === "total" ? "총 부여 일수" : "가감 일수"}
            </span>
            <input
              name="days"
              value={days}
              onChange={(e) => pickDays(e.target.value)}
              type="number"
              inputMode="decimal"
              step="0.25"
              placeholder={MODE_META[mode].placeholder}
              className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-base outline-none transition"
            />
          </label>

          <label className="block space-y-1">
            {/* 사유는 **선택**이다(원장 2026-09-21) — 비워 두고 저장할 수 있다. */}
            <span className="text-text-dim text-xs font-semibold">
              사유 <span className="text-text-faint font-normal">(선택)</span>
            </span>
            <input
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="예: 2025년도 미사용 연차 이월"
              className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-base outline-none transition"
            />
          </label>

          {/* 실제 휴가 **사용 기간**(0270b, 원장 2026-09-18: *"가감일수가 1일 이상이면 사용일 종료일
              이렇게 길게해야지 하루씩만 할수있는게 말이안되자나"*) — 선택 입력이고 하루면 종료일을 비운다.
              결재 밖에서 쓴 연차를 차감할 때 "언제부터 언제까지 쉬었나"를 사유 문장이 아니라 칸으로 남긴다
              (내 정보 카드가 이 기간으로 줄을 세운다).
              🔴 min·max로 구간을 가두지만 그게 게이트는 아니다 — 서버가 같은 판정을 한다([[#77]]). */}
          <div className="space-y-1">
            <span className="text-text-dim block text-xs font-semibold">
              휴가 사용 기간 <span className="text-text-faint font-normal">(선택)</span>
            </span>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[8.5rem] flex-1 space-y-1">
                <span className="micro">시작</span>
                <input
                  name="usedStart"
                  value={usedStart}
                  onChange={(e) => pickStart(e.target.value)}
                  type="date"
                  disabled={!usedRangeReady}
                  min={row.period?.start}
                  max={row.period?.end}
                  title={
                    usedRangeReady
                      ? "결재 밖에서 쓴 연차를 차감할 때 그 기간의 첫날 — 이월·특별휴가 부여면 비워 두세요"
                      : "사용 기간 칸이 아직 준비되지 않았습니다 — 마이그레이션 0270b"
                  }
                  className="border-line bg-card text-foreground focus:border-primary w-full rounded-lg border px-3 py-2 text-base outline-none transition disabled:opacity-50"
                />
              </label>
              <label className="min-w-[8.5rem] flex-1 space-y-1">
                <span className="micro">종료 (비우면 하루)</span>
                <input
                  name="usedEnd"
                  value={usedEnd}
                  onChange={(e) => setUsedEnd(e.target.value)}
                  type="date"
                  disabled={!usedRangeReady || !usedStart}
                  min={usedStart || row.period?.start}
                  // 🔑 가감 일수가 닿는 마지막 날까지만 — 달력이 그 뒤를 아예 못 고르게 한다.
                  max={endMax}
                  title={
                    !usedStart
                      ? "시작일을 먼저 고르세요"
                      : neededDays <= 1
                        ? "하루짜리라 시작일과 같은 날입니다"
                        : `가감 일수만큼 ${endLimit ?? ""}까지 고를 수 있습니다`
                  }
                  className="border-line bg-card text-foreground focus:border-primary w-full rounded-lg border px-3 py-2 text-base outline-none transition disabled:opacity-50"
                />
              </label>
            </div>
            <span className="text-text-faint block text-xs break-keep">
              {usedRangeReady
                ? "차감(−)이 언제 쓴 연차인지 남깁니다 — 본인 '내 정보' 화면에 이 기간으로 표시됩니다. 가감 일수만큼만 고를 수 있고, 하루면 종료일이 자동으로 채워집니다. 부여(+)면 비워 두세요."
                : "마이그레이션 0270b를 적용하면 사용 기간을 적을 수 있습니다(지금은 일수·사유만 기록됩니다)."}
            </span>
          </div>

          {/* 미리보기 — 무엇이 저장되고 총 몇 일이 되는지 누르기 전에 보인다. */}
          <div className="border-line bg-bg-soft/40 rounded-lg border px-3 py-2 text-xs break-keep">
            {!valid ? (
              <span className="text-text-faint">일수를 입력하면 결과가 여기 표시됩니다.</span>
            ) : !quarterOk ? (
              <span className="text-danger">연차는 0.25일(반반차) 단위로만 조정할 수 있습니다.</span>
            ) : negativeTotal ? (
              <span className="text-danger">총 부여 일수는 0일보다 작을 수 없습니다.</span>
            ) : delta === 0 ? (
              <span className="text-danger">
                {mode === "total"
                  ? `이미 총 ${formatLeaveDays(row.granted)}입니다 — 바뀌는 값이 없습니다.`
                  : "0일은 조정이 아닙니다."}
              </span>
            ) : overCap ? (
              <span className="text-danger">
                조정할 수 있는 상한을 넘습니다 — 한 번에 {MAX_LEAVE_DELTA}일까지, 총 부여는{" "}
                {MAX_LEAVE_TOTAL}일까지입니다.
              </span>
            ) : belowUsed ? (
              <span className="text-danger">
                이미 사용·결재중인 {formatLeaveDays(reserved)}보다 적게 조정할 수 없습니다 (결과{" "}
                {formatLeaveDays(nextTotal)}).
              </span>
            ) : endWithoutStart ? (
              <span className="text-danger">사용 시작일을 먼저 고르세요.</span>
            ) : reversed ? (
              <span className="text-danger">사용 종료일이 시작일보다 앞섭니다.</span>
            ) : outsidePeriod ? (
              <span className="text-danger">
                사용 기간이 이 연차 구간(
                <span className="num">{row.period ? leavePeriodLabel(row.period) : "—"}</span>) 밖입니다 —
                그 날이 속한 구간에서 조정하세요.
              </span>
            ) : (
              <span className="text-text-dim">
                조정 <b className="text-foreground num">{formatSignedDays(delta)}</b> 기록 → 총 부여{" "}
                <b className="text-foreground num">{formatLeaveDays(nextTotal)}</b> · 잔여{" "}
                <b className="text-foreground num">
                  {formatLeaveDays(Math.max(0, roundDays(nextTotal - reserved)))}
                </b>
              </span>
            )}
          </div>

          {/* 일수와 기간이 안 맞으면 **경고만** — 반차·반반차가 섞이면 정확히 안 맞는 게 정상이라
              막지 않는다(세션 기간 검산 0189a와 같은 결). 일수 계산은 휴가 신청과 같은 순수 함수다. */}
          {rangeMismatch ? (
            <p className="border-amber/40 bg-amber-soft text-amber rounded-lg border px-3 py-2 text-xs break-keep">
              이 기간의 연차 차감일은 <b className="num">{formatLeaveDays(rangeDays)}</b>인데 가감은{" "}
              <b className="num">{formatSignedDays(delta)}</b>입니다 — 맞는지 확인하세요(반차·반반차면 다를
              수 있고, 일요일은 세지 않습니다).
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
            <SubmitButton label="조정 기록" blocked={blocked} />
          </div>
        </form>

        {row.adjustments.length > 0 ? (
          <div className="border-line space-y-2 border-t pt-3">
            <p className="text-text-dim text-xs font-semibold">이 구간의 조정 이력</p>
            <ul className="space-y-1.5">
              {row.adjustments.map((a) => (
                <li
                  key={a.id}
                  className="border-line/70 flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <span className={`num font-bold ${a.days > 0 ? "text-green" : "text-danger"}`}>
                      {formatSignedDays(a.days)}
                    </span>
                    <span className="text-foreground ml-2 break-keep">{a.reason}</span>
                    <span className="text-text-faint ml-2 whitespace-nowrap">
                      {/* 사용일이 있으면 **그 날짜를 앞에** 둔다 — 이 줄에서 사람이 찾는 사실은
                          "언제 쓴 연차인가"이고 적은 날짜는 그다음이다. */}
                      {a.usedStart ? (
                        <>
                          사용 <span className="num">{usedRangeLabel(a.usedStart, a.usedEnd)}</span>
                          {" · "}
                        </>
                      ) : null}
                      기록 <span className="num">{a.createdAt.slice(0, 10)}</span>
                      {a.createdByName ? ` · ${a.createdByName}` : null}
                    </span>
                  </div>
                  {/* 되돌릴 수 없고 잔여가 곧바로 줄어드니 한 번 더 묻는다 — 확인은 **그 줄 안에서**
                      한다(창 위에 창을 띄우면 바깥 창의 포커스 가둠에 막혀 눌리지 않는다). */}
                  {confirmId === a.id ? (
                    <form action={delAction} className="flex shrink-0 items-center gap-1.5">
                      <input type="hidden" name="adjustmentId" value={a.id} />
                      <span className="text-text-dim whitespace-nowrap">지울까요?</span>
                      <DeleteButton />
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="text-text-faint hover:text-foreground font-semibold transition"
                      >
                        아니오
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(a.id)}
                      className="text-text-faint hover:text-danger shrink-0 font-semibold transition"
                    >
                      취소
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
