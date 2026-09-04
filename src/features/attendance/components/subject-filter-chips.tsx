"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";

/**
 * 오늘 출결 **과목별 필터 칩** — 세 탭(좌석표·확인 필요·어제 출결)이 같이 쓰는 하나
 * (원장 2026-08-20: *"오늘의 출결에서 과목별 필터링 되도록"*).
 *
 * 🔴 선택지는 **학원설정 단일 소스**다 — `useSubjectMaps().filters`(전체 + 설정 과목). 과목 라벨·키를
 *    코드에 적지 말 것(설정에 없는 '예술'이 새던 그 버그).
 * 🔴 **계정에 저장한다**(`users.ui_prefs.attendanceLive.subject`) — 학생 검색(휘발)과 다른 물건이다.
 *    클릭 즉시 화면이 좁아지고(클라가 진실) 저장은 다음 방문용이라 `router.refresh()`가 없다.
 * 🔴 좁히는 축은 **화면마다 그 화면의 단위**여야 한다(좌석표=반 카드 · 확인 필요=과목 섹션 ·
 *    어제 출결=사건 줄). 카드 안 명단까지 줄이면 미입력 4명짜리 반이 "입력 완료"로 칠해진다.
 * ⚠️ 합계·탭 배지는 **전체 기준 그대로**다(집계 분모 불변) — 그래서 무엇으로 좁혀 보고 있는지를
 *    아래 `SubjectScopeChip`으로 크게 밝힌다.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { saveLiveSubjectFilter } from "@/features/attendance/live/server/prefs-actions";
import {
  isSubjectFilterActive,
  resolveSubjectFilter,
  SUBJECT_FILTER_ALL,
} from "@/features/attendance/live/view-prefs";

/**
 * 오늘 출결(데스크·복기)·좌석표의 **과목 필터** — 계정에 저장되는 클라 상태(URL 아님).
 *
 * 2026-09-04 디자인 v5 12단계(지시서 §10): 옛 `과목` 소라벨 + 세그먼트 칩 줄(과목 수만큼 늘어난다) → **`과목: 값` 드롭다운 하나**.
 * 선택지는 학원설정 단일 소스(`useSubjectMaps().filters` = 전체 + 설정 과목) — 코드에 과목을 적지 않는다.
 * ⚠️ 파일 이름은 옛 것(`subject-filter-chips.tsx`) 그대로 — 소비처 3곳의 import 경로를 지키려고. 컴포넌트 이름은 바꿨다.
 */
export function SubjectFilterSelect({
  value,
  onPick,
  pending,
}: {
  value: string;
  onPick: (next: string) => void;
  pending?: boolean;
}) {
  const subjects = useSubjectMaps();
  // 설정 과목이 없으면(빈 학원) 드롭다운 자체가 노이즈다 — '전체' 하나만 있는 선택은 아무 일도 못 한다.
  if (subjects.filters.length <= 1) return null;
  return (
    <span
      className={`shrink-0 ${pending ? "opacity-60" : ""}`}
      title="과목별로 목록을 좁혀 봅니다(내 계정에 저장 — 다른 PC에서도 같은 상태로 열립니다)"
    >
      <SearchableSelect
        options={subjects.filters}
        value={value}
        onValueChange={(v) => {
          if (!pending && v !== value) onPick(v);
        }}
        ariaLabel="과목 필터"
        valuePrefix="과목"
        prefixOnlyFor={SUBJECT_FILTER_ALL}
        triggerClassName={TOOLBAR_SELECT}
        className="w-auto"
      />
    </span>
  );
}

/**
 * 과목 필터 상태 한 벌 — 화면은 `value`로 좁히고 `pick`을 칩에 넘긴다.
 *
 * 🔑 저장된 값이 지금 설정에 없는 과목이면(삭제·흡수) **전체로 되돌린 값**을 돌려준다 — 그대로 쓰면
 *    아무 줄도 안 걸려 빈 화면이 되고, 사용자는 "출결이 사라졌다"로 읽는다.
 */
export function useSubjectFilter(initial: string) {
  const subjects = useSubjectMaps();
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const value = resolveSubjectFilter(saved, subjects.filters);

  const pick = useCallback(
    async (next: string) => {
      if (next === saved) return;
      // 화면은 **먼저** 좁힌다 — 저장 왕복을 기다리면 칩이 굼떠 보인다(반응속도 1순위).
      setSaved(next);
      setPending(true);
      try {
        const r = await saveLiveSubjectFilter(next);
        // 저장만 실패해도 화면은 이미 좁혀졌다 — 조용히 넘기지 않고 "이번만"이라고 말한다.
        if (!r.ok) toast.error(r.error ?? "보기 설정을 저장하지 못했습니다 — 이 화면에서만 적용됩니다");
      } catch {
        toast.error("보기 설정을 저장하지 못했습니다 — 이 화면에서만 적용됩니다");
      } finally {
        setPending(false);
      }
    },
    [saved],
  );

  return { value, pick, pending, active: isSubjectFilterActive(value) };
}

/**
 * **지금 무엇으로 좁혀 보고 있는지**를 눈에 보이게 하는 칩 — 필터가 걸렸을 때만 뜬다
 * (`SearchScopeChip`과 같은 규약·같은 모양).
 *
 * 🔴 이 화면들의 합계(미출결·입력 N/M·탭 배지·상단 스탯)는 필터와 함께 좁아지지 않는다 — 그 일부만
 *    세면 "출결이 반쪽인데 숫자는 맞아 보이는" 더 나쁜 거짓말이 된다. 숫자를 줄이는 대신 필터를 크게 말한다.
 * ⚠️ 이 칩을 접거나(`<details>` 안에 넣는 것 포함) 지우지 말 것 — 접히면 없는 것과 같다.
 */
export function SubjectScopeChip({
  subject,
  shown,
  total,
  unit = "건",
  totalsNote,
}: {
  /** 지금 고른 과목 키(전체면 안 그린다). */
  subject: string;
  shown: number;
  total: number;
  unit?: string;
  totalsNote?: string;
}) {
  const subjects = useSubjectMaps();
  if (!isSubjectFilterActive(subject)) return null;
  const label = subjects.labelOf(subject) || "과목";
  return (
    <span
      className="bg-amber-soft text-amber num shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
      title={
        totalsNote
          ? `과목 필터로 목록만 좁혔습니다 — ${totalsNote}입니다.`
          : "과목 필터로 목록만 좁혔습니다."
      }
    >
      {`${label}만 보는 중 · ${shown}/${total}${unit} 표시`}
      {totalsNote ? <span className="font-medium">{` · ${totalsNote}`}</span> : null}
    </span>
  );
}

export { SUBJECT_FILTER_ALL };
