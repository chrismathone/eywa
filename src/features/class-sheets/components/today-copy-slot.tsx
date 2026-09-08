"use client";

/**
 * 오늘 보드의 **내용 복사** — 지난 수업일에서 계획을 가져와 **빈 칸만** 채운다(0209a).
 * 원본은 같은 교시이고, 강사 수업이면 **같은 요일**까지 좁힌다(0245a — 요일마다 커리큘럼이 다르다).
 * 저장은 주간 시트와 **같은 RPC**(`ecs_copy_slot`)라 여기서 새 쓰기 경로를 만들지 않는다.
 *
 * ⚠️ 시기는 **평시(regular) 고정** — 오늘 보드는 시기 구획이 없는 채우기 화면이라 여기서 내신을 고르게
 *    하면 컨트롤이 하나 더 붙는다. 내신 기간 복사는 시기 구획이 있는 주간 시트에서(카드의 링크가 그 길).
 * ⚠️ **반영 전 flush** — 복사가 대상 행을 갱신하므로, 확정 안 된 입력(디바운스 800ms)이 남아 있으면
 *    refresh가 그 글자를 앗아갈 수 있다(주간 시트 `copySlot`과 같은 계약).
 * 🔴 성공 후 `router.refresh()`만으로는 부족하다 — 0209a는 **기존 행의 빈 칸을 UPDATE**하므로 그 행의
 *    CAS 시드(expectedValue)가 옛 값으로 남는다. 서버가 돌려준 canonical 행으로 **다시 심고** 나서
 *    refresh한다(안 심으면 방금 채워진 칸을 처음 고칠 때 충돌로 뜬다).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { copySlotFromPrevious } from "../server/actions";
import type { CarryPatch } from "../lib/carry-marks";
import type { SheetSaveStore } from "./use-sheet-saves";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

export function TodayCopySlot({
  classId,
  date,
  slotStart,
  store,
  onCarried,
}: {
  classId: string;
  date: string;
  slotStart: string;
  store: SheetSaveStore;
  /**
   * JJ 이어받기로 채워진 학생 칸 — 보드가 **화면 상태에 머지**한다(직원 요청 2026-08-19).
   * 🔴 `router.refresh()`로는 안 바뀐다: 보드의 마크는 클라 state(useState(initialMarks))라
   *    서버 props가 새로 와도 그대로다. 넘기지 않으면 "복사했는데 칸이 그대로"로 보인다.
   */
  onCarried?: (slotStart: string, patches: CarryPatch[]) => void;
}) {
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={t("today.copy.title")}
      className="border-line-strong text-foreground hover:text-primary hover:border-primary cursor-pointer rounded-full border px-2 py-0.5 text-xs font-bold disabled:cursor-default disabled:opacity-60"
      onClick={() => {
        setBusy(true);
        void store
          .flush()
          .then((flushed) => {
            if (!flushed.ok) {
              const go = window.confirm(t("today.copy.unsaved"));
              if (!go) return;
            }
            return copySlotFromPrevious({ classId, planDate: date, slotStart, termMode: "regular" }).then((r) => {
              if (!r.ok) return void toast.error(r.error);
              // JJ 이어받기는 계획 복사와 **따로** 반영한다(원본이 계획 줄이 아니라 학생 기록이다).
              if (r.carried.length > 0) onCarried?.(slotStart, r.carried);
              if (r.carryError) toast.error(r.carryError);
              if (r.carryPending) {
                toast.info(t("today.copy.carryPending"));
              }
              if (r.copied === 0 && r.carrySummary) {
                toast.success(tf("today.copy.carriedOnly", { summary: r.carrySummary }));
                return;
              }
              if (r.copied === 0) {
                // 서버가 "조용히 성공한 척"을 안 한다 — 사유를 그대로 잇는다(raw 코드는 한글로).
                // ⚠️ target_not_empty는 0209a 적용 전(옛 함수)에만 온다.
                return void toast.info(
                  t(
                    r.reason === "target_already_filled"
                      ? "today.copy.none.filled"
                      : r.reason === "target_not_empty"
                        ? "today.copy.none.notEmpty"
                        : r.sameDow === true
                          ? "today.copy.none.sameDow"
                          : "today.copy.none.any",
                  ),
                );
              }
              // 갱신된 행의 CAS 시드를 다시 심는다(위 🔴) — refresh는 화면 값만 바꾸고 시드는 안 고친다.
              for (const l of r.lines) {
                store.seed(l.id, "textbook", l.textbook);
                store.seed(l.id, "page_range", l.pageRange);
                store.seed(l.id, "progress", l.progress);
                store.seed(l.id, "homework", l.homework);
                store.seed(l.id, "skill_area", l.skillArea);
              }
              toast.success(
                tf("today.copy.done", {
                  source: r.sourceLabel ? tf("today.copy.done.source", { label: r.sourceLabel }) : "",
                  n: r.copied,
                }) +
                  (r.carrySummary ? tf("today.copy.done.carry", { summary: r.carrySummary }) : "") +
                  (r.truncated > 0 ? tf("today.copy.done.truncated", { n: r.truncated }) : ""),
              );
              router.refresh();
            });
          })
          // 서버 액션 reject(네트워크 단절 등)면 아무 피드백 없이 버튼만 풀린다 — 에러를 말한다(적대 리뷰).
          .catch(() => toast.error(t("today.copy.failed")))
          .finally(() => setBusy(false));
      }}
    >
      {/* '평시'를 라벨에 밝힌다 — 내신 기간에 이 버튼이 하는 일(평시 계획 복사)이 툴팁 없이도 보이게.
          출처('지난 수업')도 라벨에 — "오늘 직전 차시인지 전날인지" 헷갈린다는 지적이 이 문구의 출발점이다. */}
      {busy ? t("today.copy.busy") : t("today.copy")}
    </button>
  );
}
