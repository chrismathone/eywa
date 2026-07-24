"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { toast } from "sonner";

import { CalendarOff, Filter, ListFilter, RotateCcw } from "@/components/icons/eywa-icon-compat";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import {
  bucketsOf,
  gradeFilterLabel,
  gradesInBucket,
  normalizeGradeSelection,
} from "@/features/timetable/lib/view-prefs";
import { TimetableColorToggle } from "./color-mode-toggle";

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
 *
 * ⚠️ 2026-07-24(원장 "시간표도 깔끔하게"): **표시 취향 3종도 여기로 흡수**했다 — 색 강도(칩 3개)·
 * 빈 교시 접기·미사용 요일. 툴바가 2줄로 넘치던 주범이 색 3칩이었고, 셋 다 "무엇이 보이나"를 정하는
 * 같은 성격이라 학년 필터와 한 곳에 있는 게 맞다.
 * ⚠️ 단 **적용 시점이 다르다**: 학년은 초안+'적용'(계정 저장 1회), 표시 3종은 **즉시 반영**
 * (색=스토어 직행, 빈교시·미사용요일=URL 링크 네비). 섞이면 "취소했는데 색은 바뀜"으로 읽히므로
 * 구분선 + 안내 문구로 갈라 놨다. 링크는 네비하며 팝오버가 닫히는데, 이는 툴바 칩을 누르던 때와 같다.
 */
export function TimetableViewSettings({
  allGrades,
  savedGrades,
  showColor = false,
  collapseHref,
  collapseOn = false,
  hideEmptyDaysHref,
  hideEmptyDaysOn = false,
}: {
  /** 학원설정(operations.gradeLevels) — 학년 목록의 단일 소스. 여기에 하드코딩 금지. */
  allGrades: string[];
  /** 계정에 저장된 선택. null = 전체. */
  savedGrades: string[] | null;
  /** 색 강도 노출 = 셀 색이 있는 기본뷰에서만. */
  showColor?: boolean;
  /** 기본뷰 '빈 교시 접기' 토글 링크(반대 상태로 가는 href). 없으면 항목 자체를 숨긴다. */
  collapseHref?: string;
  collapseOn?: boolean;
  /** 강사뷰 '미사용 요일' 토글 링크. 없으면 숨김. */
  hideEmptyDaysHref?: string;
  hideEmptyDaysOn?: boolean;
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
  // 표시 토글(링크) 알약 — 툴바에 있던 것과 같은 모양으로 옮겨 온다(사용자가 찾던 그 칩).
  const toggleCls = (on: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
      on
        ? "border-primary bg-primary text-primary-foreground font-medium"
        : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
    }`;
  // 아무것도 안 고른 상태는 '전체'와 같게 저장된다(빈 화면에 스스로 갇히지 않게) — 문구로 미리 알린다.
  const noneSelected = draft.length === 0;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        // ⚠️ 열 때마다 초안을 **저장된 값으로 재시드**한다(2026-07-24 적대검수).
        // 안 하면: 학년을 고치다 '취소'로 닫은 초안이 그대로 살아 있다가, 나중에 색 강도를 바꾸려고
        // 팝오버를 다시 열어 '적용'을 누르는 순간 **그 옛 초안이 계정에 저장돼** 전 기기에서 학생이 사라진다.
        // 표시 토글을 여기로 들여오며 팝오버를 훨씬 자주 열게 됐으므로 실제로 밟히는 경로가 됐다.
        if (o) setDraft(savedGrades ?? allGrades);
        setOpen(o);
      }}
    >
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

            {/* ── 표시(즉시 반영) — 위 학년(초안+적용)과 적용 시점이 달라 구분선과 문구로 가른다.
                   여기 있던 칩들이 툴바를 2줄로 밀어내던 주범(특히 색 3칩)이라 이리로 흡수했다. ── */}
            {showColor || collapseHref || hideEmptyDaysHref ? (
              <div className="border-line mb-2 border-t pt-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-foreground text-xs font-semibold">표시</span>
                  <span className="text-text-faint text-[10px]">바로 적용됩니다</span>
                </div>
                {showColor ? <TimetableColorToggle /> : null}
                {collapseHref || hideEmptyDaysHref ? (
                  <div className={`flex flex-wrap items-center gap-1 ${showColor ? "mt-1.5" : ""}`}>
                    {collapseHref ? (
                      <Link
                        href={collapseHref}
                        title="수업 없는 교시 행을 얇게 접기/펼치기 (편집 중엔 자동으로 펼쳐짐)"
                        className={toggleCls(collapseOn)}
                      >
                        <ListFilter size={11} strokeWidth={1.8} />
                        빈 교시 접기
                      </Link>
                    ) : null}
                    {/* ⚠️ 강조는 `!hideEmptyDays`일 때 — "미사용 요일을 **보여주는**" 상태가 켜짐이다(툴바 원본과 동일). */}
                    {hideEmptyDaysHref ? (
                      <Link
                        href={hideEmptyDaysHref}
                        title="수업 없는 요일 컬럼 표시/숨김"
                        className={toggleCls(!hideEmptyDaysOn)}
                      >
                        <CalendarOff size={11} strokeWidth={1.8} />
                        미사용 요일
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

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
