"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2 } from "@/components/icons/eywa-icon-compat";
import { planMonthLabel } from "@/features/timetable-dev/types";
import { deletePlanMonth, seedPlanFromLive } from "@/features/timetable-dev/server/actions";
// ⚠️ `copyPlanMonth`(달 복제)는 서버에 그대로 남아 있다 — 화면에서만 뺐다(원장 지시로 '다음 달
//    만들기'가 시트 기반이 됐다). 되살릴 일이 생기면 액션은 이미 있고 테스트도 통과 중이다.

/**
 * 월별 계획 만들기/복사/삭제 진입 버튼.
 *
 * ⚠️ **서버 액션 직후의 `router.push`는 삼켜진다**([[#102]]) — 액션 응답이 현재 페이지 RSC를 다시 적용하며
 *    방금 시작한 이동을 덮는다. 그래서 다른 달로 **이동**하는 경로(다음 달 만들기)는 `window.location.assign`,
 *    같은 달을 다시 그리는 경로(가져오기·삭제)는 `router.refresh()`만 쓴다.
 *
 * ⚠️ 액션 반환값은 `unknown`으로 받는다 — `{ok:false,error}`든 `{error}`든 void든 이 버튼이 안 깨진다
 *    (계약이 넓어져도 화면이 따라 깨지지 않게).
 */
function errorOf(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const r = res as { ok?: unknown; error?: unknown };
  const failed = r.ok === false || (r.ok === undefined && typeof r.error === "string");
  if (!failed) return null;
  return typeof r.error === "string" && r.error.trim() ? r.error : "처리하지 못했습니다";
}

const BTN =
  "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50";

export function PlanMonthActions({
  month,
  hasPlan,
  canManage,
  compact = false,
}: {
  /** 지금 보고 있는 계획 달(YYYY-MM). */
  month: string;
  /** 이 달에 계획 칸이 하나라도 있는지 — 문구·확인 창·삭제 버튼 노출이 갈린다. */
  hasPlan: boolean;
  /** 계획 쓰기 권한(반 관리 = classes full). 없으면 버튼을 아예 안 그린다. */
  canManage: boolean;
  /** 빈 상태 카드 안에서 쓸 때 — 세로로 크게. 툴바에선 false(한 줄). */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  /** 화면에 보이는 건 항상 한글 요약(`text`) — 기술 원문은 툴팁(`detail`)으로만(raw 노출 금지 규약). */
  const [msg, setMsg] = useState<{ text: string; detail?: string } | null>(null);

  if (!canManage) return null;

  const run = (fn: () => Promise<unknown>, goHref?: string) => {
    setMsg(null);
    start(async () => {
      try {
        const res = await fn();
        const err = errorOf(res);
        if (err) {
          // 서버 액션이 준 문구는 사람이 읽으라고 쓴 한글 안내라 그대로 보여준다.
          setMsg({ text: err });
          return;
        }
        if (goHref) window.location.assign(goHref);
        else router.refresh();
      } catch (e) {
        setMsg({
          text: "처리하지 못했습니다 — 잠시 후 다시 시도해 주세요",
          detail: e instanceof Error ? e.message : undefined,
        });
      }
    });
  };

  // 🔴 두 액션은 **대상 달에 이미 칸이 있으면 기본적으로 거절**한다(actions.ts — 덮어쓰면 손으로 고친
  //    계획이 통째로 날아가고 되돌릴 문이 없다). 그래서 덮어쓰기는 여기서 **한 번 더 묻고 명시**로만 넘긴다.
  const onSeed = () => {
    if (hasPlan) {
      if (
        !window.confirm(
          `${planMonthLabel(month)} 계획을 지우고 현재 시간표 배치로 새로 채웁니다.\n손으로 고쳐 둔 내용은 사라지며 되돌릴 수 없습니다. 계속할까요?`,
        )
      )
        return;
      run(() => seedPlanFromLive(month, { overwrite: true }));
      return;
    }
    run(() => seedPlanFromLive(month));
  };

  const onDelete = () => {
    if (!window.confirm(`${planMonthLabel(month)} 계획을 통째로 지웁니다. 되돌릴 수 없습니다. 계속할까요?`))
      return;
    run(() => deletePlanMonth(month));
  };

  return (
    <div
      className={
        compact
          ? "flex flex-col items-stretch gap-2"
          : "flex flex-wrap items-center gap-1"
      }
    >
      <button type="button" onClick={onSeed} disabled={pending} className={BTN} title={`${planMonthLabel(month)} 계획을 현재 시간표 배치로 채웁니다`}>
        {pending ? <Loader2 size={11} strokeWidth={1.8} className="animate-spin" /> : <Download size={11} strokeWidth={1.8} />}
        현재 시간표에서 가져오기
      </button>
      {hasPlan ? (
        <button type="button" onClick={onDelete} disabled={pending} className={`${BTN} hover:text-danger`} title={`${planMonthLabel(month)} 계획을 삭제합니다`}>
          <Trash2 size={11} strokeWidth={1.8} />
          이 달 계획 삭제
        </button>
      ) : null}
      {/* '다음 달 만들기'는 이제 **시트 가져오기**가 담당한다(대상 달만 다음 달로 열린다, month-nav).
          계획 복제는 새 달에 옛 배치를 그대로 복사할 뿐이라 "달마다 같은 시간표"가 되던 원인이었다. */}
      {msg ? (
        <span
          className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-[11px] break-keep"
          title={msg.detail}
        >
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
