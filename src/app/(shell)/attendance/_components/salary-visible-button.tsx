"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { tipProps } from "@/components/hover-tip/tip";
import { saveAttendanceSalaryVisible } from "@/features/attendance/server/salary-rates-actions";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * '합계 및 실급여 보여주기' 버튼 — **선생님 × 달** 스위치(0352a · 달별 0353a).
 *
 * 원장 2026-10-07: *"권한자가 월별 출석부에서 해당 선생님의 실급여 보이기 토글을 on하면 실제 강사뷰의 강사가 출석부에서
 * 합계 및 실급여를 볼 수 있게"* · *"이름을 합계 및 실급여 보여주기로 버튼 변경 (마우스 오버시 자세한 설명)"*.
 * 그전의 '실급여 보이기' 체크는 **누르는 사람의 보기 설정**이라 선생님 화면엔 아무 영향이 없었다(원장 제보의 원인).
 *
 * 🔴 켜면 그 선생님 본인 출석부(강사 화면)에도 실급여 열과 합계가 선다 — 보기 설정이 아니라 급여 숫자를 여는 결정이다.
 *    그래서 급여 비율을 고칠 수 있는 사람만 누르고(`canEdit` — 서버 액션이 같은 판정을 다시 한다), 저장되면 **누구에게 보이게 됐는지** 알린다.
 * 🔴 눌림 상태는 **그 선생님 · 그 달의 것**이다 — 강사나 달을 바꾸면 처음부터 다시 읽는다(`teacherId`·`month`가 바뀌면 초기화 · 페이지도 `key`로 갈아 끼운다).
 *    안 그러면 A 선생님을 켠 직후 B 선생님으로 넘어갔을 때 B가 실제와 반대로 보인다(적대 리뷰 2026-10-07).
 * ⚠️ 열은 **서버가** 실급여 값을 실어야 서므로 저장 후 `router.refresh()`.
 * ⚠️ 설명은 카드 툴팁(`data-tip`)으로 — 여러 줄이라 `title`로는 읽기 어렵다(같은 내용을 `title`로 겹쳐 달지 않는다).
 * ⚠️ 상태 점은 켜짐·꺼짐 **같은 폭**이다 — 누를 때 버튼 폭이 변하면 표 위 한 줄이 밀린다.
 */
export function SalaryVisibleButton({ teacherId, month, checked, canEdit }: {
  teacherId: string;
  /** 출석부가 보는 달(`YYYY-MM`) — 스위치는 달마다 따로다(원장 2026-10-07 *"9월에 보여주기 눌렀다고해서 10월에 보여주는건 아님"*). */
  month: string;
  checked: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const m = Number(month.slice(5, 7));
  const [pending, startTransition] = useTransition();
  // 누르는 즉시 눌림이 바뀌게(서버 왕복 동안 옛 상태로 보이면 두 번 누른다). 새로 그려지면 서버 값이 이긴다.
  const [local, setLocal] = useState(checked);
  const [source, setSource] = useState({ teacherId, month, checked });
  if (source.teacherId !== teacherId || source.month !== month || source.checked !== checked) {
    setSource({ teacherId, month, checked });
    setLocal(checked);
  }

  return (
    <button
      type="button"
      aria-pressed={local}
      aria-busy={pending}
      disabled={pending || !canEdit}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs whitespace-nowrap disabled:cursor-default ${
        local ? "border-primary bg-primary-soft text-primary font-bold" : "border-line bg-card"
      } ${pending ? "opacity-60" : ""}`}
      {...tipProps({
        title: t("att.actualSalary.toggle"),
        meta: t(local ? "att.actualSalary.stateOn" : "att.actualSalary.stateOff"),
        lines: [
          t("att.actualSalary.tipOn"),
          t("att.actualSalary.tipOff"),
          tf("att.actualSalary.tipScope", { m }),
          t("att.actualSalary.tipFormula"),
          canEdit ? null : t("att.actualSalary.tipReadonly"),
        ],
      })}
      onClick={() => {
        const next = !local;
        const target = { teacherId, month };
        setLocal(next);
        // 실패하면 눌림을 되돌리고 **알린다** — 말없이 되돌아가면 "눌렀는데 안 먹는다"로 읽힌다.
        // 액션이 던지는 경우(네트워크 끊김)도 같은 갈래로 받는다(안 받으면 저장 안 된 눌림이 남고 오류가 경계로 샌다).
        startTransition(async () => {
          let result: { ok: boolean; error?: string } = { ok: false };
          try {
            result = await saveAttendanceSalaryVisible({ ...target, visible: next });
          } catch {
            result = { ok: false };
          }
          if (!result.ok) {
            setLocal(!next);
            toast.error(result.error ?? t("att.actualSalary.saveFailed"));
            return;
          }
          // 같은 자리의 버튼 뜻이 '혼자 보기'에서 '선생님에게 공개'로 바뀌었다 — 켜는 순간 누구에게 보이게 되는지 말한다.
          toast.success(tf(next ? "att.actualSalary.savedOn" : "att.actualSalary.savedOff", { m: Number(target.month.slice(5, 7)) }));
          router.refresh();
        });
      }}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full border ${local ? "border-primary bg-primary" : "border-line"}`} />
      {t("att.actualSalary.toggle")}
    </button>
  );
}
