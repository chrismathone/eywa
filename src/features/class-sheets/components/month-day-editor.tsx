"use client";

/**
 * 월간 뷰의 **그 날짜 고치기** 창 — 달력은 칸을, 진도표는 날짜 열 머리를 누르면 열린다
 * (원장 2026-09-01 *"ecs 월간뷰에서도 더블클릭으로 해당날짜 수정가능하게"* → 같은 날 *"클릭 주간
 * 이동은 기능 삭제할것"* 으로 칸에서 다투던 이동이 사라져 **한 번만 눌러도** 열린다).
 *
 * 🔑 **계획 편집기를 새로 만들지 않는다.** 교시 하나당 [`SlotPlanBlock`](./slot-plan-block.tsx) 한 장을
 *    세울 뿐이고, 그 안의 표·기계·저장 경로(CAS·`ecs_*` RPC·저널·presence)는 주간 시트·자리 출석부와
 *    같은 한 벌이다. 저널 키와 presence scope가 **주차 축**이라 이 창에서 고치는 동안 주간 시트를 열어 둔
 *    사람에게 "수정중"이 그대로 뜬다.
 *
 * 🔴 줄은 월간 조회가 아니라 [`getEcsDayPlan`](../server/day-plan.ts)이 **다시** 읽는다 — 월간 조회는
 *    빈 줄·고아 줄을 걸러 주므로 그대로 심으면 CAS 기대값이 어긋난다(그 파일 🔴 참조).
 * 🔴 닫을 때 **저장 큐를 비운 뒤** 호출부가 다시 읽는다(`onSaved`) — 안 비우면 방금 친 글자가 날아가기
 *    전에 월간이 옛 값을 다시 그려 "고쳤는데 그대로"가 된다. 그래서 블록마다 flush를 등록받는다.
 * ⚠️ 자리(JJ·랩실) 교시도 그대로 연다 — 반 진도가 아니라 학생 개별 진도지만, 그 칸의 계획 줄은 여기
 *    같은 표에 산다(주간 시트와 같다). 대신 배지로 자리임을 밝힌다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/eywa-icons";
import { mondayOf } from "@/features/timetable/lib/week";
import { getEcsDayPlan, type EcsDayPlan } from "../server/day-plan";
import { slotKey } from "../lib/month-assemble";
import type { MonthSlot } from "../lib/month-assemble";
import { SlotPlanBlock } from "./slot-plan-block";
import { ECS_PLAN_API } from "./plan-api";

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 닫을 때 저장이 끝나기를 기다리는 상한 — 넘으면 그냥 닫는다(못 나간 입력은 저널에 남는다). */
const FLUSH_WAIT_MS = 5000;

/**
 * 열린 직후 잠깐은 **바깥 클릭으로 안 닫힌다**.
 *
 * 🔴 이 창은 2026-09-01 아침까지 **더블클릭 전용**이었어서 사람들이 여전히 두 번 누른다. 이제 첫
 *    클릭이 창을 여는데, 두 번째 클릭은 ~100ms 뒤 **backdrop**(`fixed inset-0`)에 떨어져 방금 연
 *    창을 그대로 닫는다 — 게다가 팝업 위(가운데 칸)면 안 닫혀서 **누른 자리에 따라 되기도 안 되기도**
 *    하는 가장 나쁜 모양이 된다. 그 사이만 바깥 클릭을 무시한다.
 * ⚠️ 사람이 일부러 닫는 데엔 영향이 없다(이 시간 안에 의도적으로 닫는 일은 없고, 닫기 버튼은 그대로).
 */
const OUTSIDE_CLOSE_GRACE_MS = 400;

/** "2026-09-03" → "9/3 (목)" — 창 제목은 짧게, 연도는 월간 툴바가 이미 말하고 있다. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = DOW_KO[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? "";
  return `${m}/${d} (${dow})`;
}

export function MonthDayEditor({
  classId,
  className,
  date,
  slots,
  periodLabelBySlot,
  onClose,
  onSaved,
}: {
  classId: string;
  className: string;
  date: string;
  /** 그 날 실제로 도는 교시(월간 조회가 이미 날짜 단위로 판정해 둔 것 — 여기서 다시 정하지 않는다). */
  slots: MonthSlot[];
  periodLabelBySlot: Record<string, string>;
  onClose: () => void;
  /** 저장 큐를 다 비운 뒤 호출 — 호출부가 월간을 다시 읽어 배지·경고를 갱신한다. */
  onSaved: () => void;
}) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; plan: EcsDayPlan }>({
    kind: "loading",
  });
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  // 블록마다 저장 큐 flush를 등록받는다(닫기 전에 함께 비운다). 언마운트 시 스스로 지운다.
  const flushers = useRef(new Map<string, () => Promise<unknown>>());
  // 열린 직후 바깥 클릭을 무시하는 창(위 OUTSIDE_CLOSE_GRACE_MS 주석 — 더블클릭의 두 번째 클릭).
  const outsideArmedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void getEcsDayPlan({ classId, planDate: date }).then((res) => {
      if (!alive) return;
      setState(res.ok ? { kind: "ready", plan: res.data } : { kind: "error", message: res.error });
    });
    return () => {
      alive = false;
    };
  }, [classId, date]);

  // 바깥 클릭 닫기를 조금 늦게 켠다(위 OUTSIDE_CLOSE_GRACE_MS 🔴).
  useEffect(() => {
    const t = window.setTimeout(() => {
      outsideArmedRef.current = true;
    }, OUTSIDE_CLOSE_GRACE_MS);
    return () => window.clearTimeout(t);
  }, []);

  const registerFlush = useCallback((slotStart: string, flush: (() => Promise<unknown>) | null) => {
    if (flush) flushers.current.set(slotStart, flush);
    else flushers.current.delete(slotStart);
  }, []);

  /**
   * 열려 있는 블록들의 저장 큐를 비운다.
   * ⚠️ **기다리다 갇히지 않게** 상한을 둔다([[#102]]) — 서버가 안 돌아오면 창이 '저장 중…'에서 영원히
   *    안 닫힌다. 넘겨도 잃는 건 없다: 못 나간 입력은 저널(IndexedDB)에 남아 다음에 복구된다.
   */
  const flushAll = useCallback(() => {
    const pending = [...flushers.current.values()].map((f) => f().catch(() => undefined));
    return Promise.race([
      Promise.all(pending).then(() => undefined),
      new Promise<undefined>((r) => window.setTimeout(() => r(undefined), FLUSH_WAIT_MS)),
    ]);
  }, []);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    void flushAll().then(() => {
      onSaved();
      onClose();
    });
  }, [closing, flushAll, onClose, onSaved]);

  /**
   * 주간 시트로 — 🔴 **떠나기 전에도 저장을 기다린다.** 링크로 그냥 두면 방금 친 글자가 아직 큐에 있는
   * 채로 화면이 바뀌어, 주간 시트가 옛 값을 그린다(닫기와 같은 실패 모양). 주간 시트 자신도 이동 전에
   * 같은 순서를 지킨다(`sheet-client`의 `navigate`).
   */
  const goWeek = useCallback(() => {
    if (closing) return;
    setClosing(true);
    void flushAll().then(() => router.push(`/ecs/${classId}?week=${mondayOf(date)}&day=${date}`));
  }, [classId, closing, date, flushAll, router]);

  return (
    <Dialog
      open
      onOpenChange={(next, details) => {
        if (next) return;
        // 열자마자 날아온 **바깥 클릭**은 무시한다 — 더블클릭의 두 번째 클릭이 backdrop에 떨어져
        // 방금 연 창을 닫는 것(위 🔴). 판정은 Base UI가 주는 `reason`이라 추측이 없다:
        // Esc(`escape-key`)·닫기 버튼(자체 onClick)은 이 창에 안 걸린다.
        const outside = details.reason === "outside-press" || details.reason === "focus-out";
        if (outside && !outsideArmedRef.current) return;
        close();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto px-2 sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader className="gap-1 px-2">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-[15px] font-bold">
              <span className="num">{dayLabel(date)}</span> 수업계획
            </DialogTitle>
            <span className="text-text-dim text-[12.5px] font-semibold">{className}</span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={goWeek}
                disabled={closing}
                className="border-line-strong text-text-dim hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2.5 py-1 text-[12px] font-bold disabled:cursor-default disabled:opacity-60"
                title="출결·태도·학생 칸까지 있는 주간 시트로 갑니다 — 여기 적은 내용을 저장한 뒤 이동합니다"
              >
                주간 시트로
              </button>
              <button
                type="button"
                onClick={close}
                disabled={closing}
                className="border-line-strong text-foreground hover:border-primary hover:text-primary inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-bold disabled:cursor-default disabled:opacity-60"
              >
                {closing ? "저장 중…" : <><EyIcon name="close" size={12} /> 닫기</>}
              </button>
            </span>
          </div>
          {/* 창을 닫아야 반영되는 게 아니라는 걸 밝힌다 — 시트와 같은 자동저장이다. */}
          <p className="text-text-faint text-[11.5px]">
            주간 시트와 같은 칸입니다 — 치는 대로 저장되고, 닫으면 이 달의 미작성·목표 밖 표시가 다시 계산됩니다.
          </p>
        </DialogHeader>

        {state.kind === "loading" ? (
          <p className="text-text-dim px-2 py-6 text-[13px]">수업계획을 불러오는 중…</p>
        ) : state.kind === "error" ? (
          <p className="border-danger/40 bg-danger-soft text-danger mx-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold">
            {state.message}
          </p>
        ) : slots.length === 0 ? (
          <p className="text-text-dim px-2 py-6 text-[13px]">이 날은 배정된 교시가 없습니다.</p>
        ) : (
          <div className="min-w-0">
            {slots.map((slot) => (
              <DaySlot
                key={slot.slotStart}
                classId={classId}
                date={date}
                slot={slot}
                periodLabel={periodLabelBySlot[slotKey(date, slot.slotStart)] ?? null}
                plan={state.plan}
                registerFlush={registerFlush}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DaySlot({
  classId,
  date,
  slot,
  periodLabel,
  plan,
  registerFlush,
}: {
  classId: string;
  date: string;
  slot: MonthSlot;
  periodLabel: string | null;
  plan: EcsDayPlan;
  registerFlush: (slotStart: string, flush: (() => Promise<unknown>) | null) => void;
}) {
  const onFlush = useCallback(
    (flush: (() => Promise<unknown>) | null) => registerFlush(slot.slotStart, flush),
    [registerFlush, slot.slotStart],
  );
  return (
    <section className="min-w-0">
      <div className="bg-bg-soft flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
        <span className="num text-[13px] font-bold">
          {slot.slotStart}
          {slot.slotEnd ? `~${slot.slotEnd}` : ""}
        </span>
        {periodLabel ? <span className="text-text-dim text-[11.5px] font-semibold">{periodLabel}</span> : null}
        <span className="text-text-dim text-[12px]">{slot.teacherLabel ?? "담당 미지정"}</span>
        {slot.seat ? (
          <span
            className="border-line-strong text-text-dim rounded-full border px-1.5 text-[10.5px] leading-4 font-bold"
            title="자리 교시 — 반 진도가 아니라 학생 개별 진도입니다"
          >
            자리 · {slot.seat}
          </span>
        ) : null}
      </div>
      <SlotPlanBlock
        classId={classId}
        api={ECS_PLAN_API}
        tenantId={plan.tenantId}
        userId={plan.userId}
        weekMonday={plan.weekMonday}
        planDate={date}
        slotStart={slot.slotStart}
        initialLines={plan.linesBySlot[slot.slotStart] ?? EMPTY_LINES}
        skillAreas={plan.skillAreas}
        canEdit={plan.canEdit}
        showExamTerm={plan.showExamTerm}
        registerFlush={onFlush}
      />
    </section>
  );
}

/** `SlotPlanBlock`은 `memo`라 매 렌더 새 배열을 넘기면 그 반의 표가 통째로 다시 그려진다. */
const EMPTY_LINES: never[] = [];
