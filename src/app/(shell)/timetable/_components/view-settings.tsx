"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { toast } from "sonner";

import { Filter, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import {
  bucketsOf,
  gradeFilterLabel,
  gradesInBucket,
  normalizeGradeSelection,
} from "@/features/timetable/lib/view-prefs";

/**
 * 시간표 '뷰 설정' — 학제/학년으로 학생을 켜고 끈다. 설정은 **계정에 저장**돼 다른 기기에서도 따라온다
 * (원장 지시 2026-07-23, 0146a users.ui_prefs).
 *
 * ⚠️ 왜 툴바 인라인 토글이 아니라 팝오버인가: 툴바엔 이미 주간이동·과목칩(n개)·구분 3·뷰 3·표시 토글·
 * 엑셀/시트·편집이 한 줄에 있어서 포화 상태다(같은 파일에 "여기 두면 상시 2줄로 강제된다"는 회귀 주석이
 * 이미 있다). 학제 3개를 더 얹으면 확정적으로 2줄이 된다. 팝오버로 빼면 가로 압박이 없어져 학제 3개가
 * 아니라 **학년 12개**까지 담을 수 있다("고3만" 같은 시야도 가능).
 *
 * ⚠️ 필터가 걸린 동안엔 트리거에 **항상 배지**가 뜬다. 계정에 저장된 필터가 조용히 학생을 숨기면
 * "왜 학생이 안 보이지"가 되기 때문 — 이건 타협하지 않는다.
 */
export function TimetableViewSettings({
  allGrades,
  savedGrades,
}: {
  /** 학원설정(operations.gradeLevels) — 학년 목록의 단일 소스. 여기에 하드코딩 금지. */
  allGrades: string[];
  /** 계정에 저장된 선택. null = 전체. */
  savedGrades: string[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // 패널 안에서는 로컬 상태로 고르고 '적용'에서 한 번만 저장한다(체크박스마다 왕복하지 않는다).
  const [draft, setDraft] = useState<string[]>(savedGrades ?? allGrades);

  const badge = gradeFilterLabel(savedGrades, allGrades);
  const buckets = bucketsOf(allGrades);

  const toggleGrade = (g: string) =>
    setDraft((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const bucketState = (b: string): "all" | "some" | "none" => {
    const gs = gradesInBucket(allGrades, b);
    const n = gs.filter((g) => draft.includes(g)).length;
    return n === 0 ? "none" : n === gs.length ? "all" : "some";
  };

  // 학제 버튼 = 그 학제 전체를 켜고 끈다. 다 켜져 있으면 끄고, 아니면 전부 켠다.
  const toggleBucket = (b: string) => {
    const gs = gradesInBucket(allGrades, b);
    setDraft((prev) =>
      bucketState(b) === "all"
        ? prev.filter((g) => !gs.includes(g))
        : [...prev.filter((g) => !gs.includes(g)), ...gs],
    );
  };

  const apply = () => {
    const grades = normalizeGradeSelection(draft, allGrades);
    startTransition(async () => {
      // ⚠️ **grades 키만** 보낸다 — 저장은 부분 병합이라, 여기서 다른 키를 함께 넘기면
      // 표시 토글(미사용 요일·빈 교시·1시간 단위·색)이 이 저장에 덮여 날아간다.
      const res = await saveTimetableViewPrefs({ grades });
      if (!res.ok) {
        toast.error(res.error ?? "뷰 설정을 저장하지 못했습니다");
        return;
      }
      setOpen(false);
      toast.success(grades ? `${gradeFilterLabel(grades, allGrades)} 보기로 저장했습니다` : "전체 학년 보기로 저장했습니다");
      router.refresh();
    });
  };

  const reset = () => setDraft(allGrades);
  // 아무것도 안 고른 상태는 '전체'와 같게 저장된다(빈 화면에 스스로 갇히지 않게) — 문구로 미리 알린다.
  const noneSelected = draft.length === 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
          badge
            ? "border-primary bg-primary text-primary-foreground font-medium"
            : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
        }`}
        title="학제·학년으로 보이는 학생을 고른다 (내 계정에 저장)"
      >
        <Filter size={11} strokeWidth={1.8} aria-hidden />
        {badge ?? "뷰 설정"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border p-3 text-left outline-none">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-foreground text-xs font-semibold">보이는 학년</span>
              <button
                type="button"
                onClick={reset}
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-[11px]"
              >
                <RotateCcw size={10} strokeWidth={1.8} aria-hidden />
                전체
              </button>
            </div>

            {/* 학제 = 그 학제 학년을 통째로 켜고 끈다. */}
            <div className="mb-2 flex flex-wrap gap-1">
              {buckets.map((b) => {
                const st = bucketState(b);
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBucket(b)}
                    aria-pressed={st === "all"}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                      st === "all"
                        ? "border-primary bg-primary text-primary-foreground font-medium"
                        : st === "some"
                          ? "border-primary text-primary bg-primary-soft"
                          : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                    }`}
                  >
                    {b}
                  </button>
                );
              })}
            </div>

            {/* 학년 = 정밀 선택. 팝오버라 가로 압박이 없어 12개를 다 펼 수 있다. */}
            <div className="mb-2 grid grid-cols-6 gap-1">
              {allGrades.map((g) => {
                const on = draft.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGrade(g)}
                    aria-pressed={on}
                    className={`rounded-lg border px-1 py-1 text-[11px] transition ${
                      on
                        ? "border-foreground bg-foreground text-background font-medium"
                        : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>

            <p className="text-text-dim mb-2 text-[11px] leading-relaxed">
              {noneSelected
                ? "아무것도 고르지 않으면 전체 학년을 봅니다."
                : "학생 기준으로 걸러집니다. 학년이 섞인 반은 사라지지 않고 명단만 좁아집니다."}
            </p>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border-line text-text-dim hover:text-foreground rounded-lg border px-2.5 py-1 text-xs"
              >
                취소
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={pending}
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                {pending ? "저장 중…" : "적용"}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
