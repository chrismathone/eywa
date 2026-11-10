"use client";

import { useState } from "react";
import { CLASS_TAG_ALL } from "../class-tags";
import { isClassMember, rowInClass, studentInClass } from "../grid";
import type { TodayClass } from "../server/roster";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import { CLASSNOTE_ONLY_VIEWS, type OneScreenView } from "../view";
import {
  applyWriteFilter,
  countByWriteFilter,
  isStudentWritten,
  matchesWriteFilter,
  type WriteFilter,
} from "../write-filter";
import type { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 원스크린 명단 보기 상태 — 수정 계획 P3-O 3/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 반 필터·작성 상태 필터(+누른 시점 고정)·선택 학생·뷰(카드/표/…)와, 그것으로 좁힌 표시 목록(`visible`)·선택 학생(`selected`)을
 * 한 곳에서 낸다. 🔴 표시 목록과 일괄 저장·발송·자동작성 대상은 **같은 `visible`** 이다(아래 주석).
 * 파생값은 예전처럼 렌더마다 그대로 계산한다(메모 없음).
 */
export function useRosterView({
  initial,
  initialStudentId,
  initialClassName,
  initialView,
  readonlyView,
  classnoteOn,
  students,
  reports,
  todayClasses,
  t,
}: {
  initial: OneScreenStudent[];
  initialStudentId: string | null;
  initialClassName: string | null;
  initialView: OneScreenView;
  readonlyView: boolean;
  classnoteOn: boolean;
  students: OneScreenStudent[];
  reports: ReportsState;
  todayClasses: TodayClass[];
  t: ReturnType<typeof useSheetT>;
}) {
  // 진입 시 반·학생 지정(2026-08-07) — '오늘 ECS' 카드에서 넘어올 때 그 반(·그 학생)에서 시작한다.
  // ⚠️ 값 검증은 **서버**가 한다(그 날짜 로스터에 실제로 있는 반/학생만 내려온다) — 여기선 그대로 쓴다.
  const [selId, setSelId] = useState<string>(initialStudentId ?? initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>(initialClassName ?? CLASS_TAG_ALL);
  // 작성 상태 필터(전체/작성/미작성) + 그 필터를 누른 시점의 대상 고정 — 입력 중 카드·행이 사라지지 않게.
  // (판정·합집합 규칙은 write-filter.ts. 날짜 이동은 클라 재마운트라 필터도 '전체'로 초기화된다.)
  const [writeFilter, setWriteFilter] = useState<WriteFilter>("all");
  const [writePins, setWritePins] = useState<ReadonlySet<string>>(() => new Set<string>());
  // 카드 ↔ 표 ↔ 발송 현황 ↔ 지난 보고서 ↔ 공지. 초기값은 URL(?view=) — 날짜 이동 후에도 보던 뷰 유지.
  // 토글 자체는 클라 state만 바꾼다(네비 없음) — 뷰 전환마다 서버 왕복하면 체감이 느려진다.
  // 열람 전용은 공지 뷰로 착지하지 않는다(?view=notice 북마크·날짜 내비 URL 잔존 대비) — 공지는 순수 작성 화면.
  const [view, setView] = useState<OneScreenView>(
    (readonlyView && initialView === "notice") || (!classnoteOn && CLASSNOTE_ONLY_VIEWS.has(initialView))
      ? "card"
      : initialView,
  );

  // 반 필터 — 특정 반이면 그 반 수강생 전부(tags로 다과목/다반 학생도 양쪽에서 잡음, 누락 방지) + 좌측 그룹 라벨을
  // 필터 반으로 리맵. 표 행은 activeClassFilter로 rowInClass 필터해 타 반 과목 행 혼입을 막는다.
  const activeClassFilter = classFilter === CLASS_TAG_ALL ? null : classFilter;
  // ⚠️ 보강(수업외)은 반 무관이라 필터를 통과시킨다(studentInClass) — 안 그러면 특정 반을 고른 채 추가한
  //    보강 학생이 카드째 사라진다(2026-07-27 강사 제보). 라벨 리맵은 **그 반 실제 수강생에게만**:
  //    보강 카드까지 리맵하면 듣지도 않는 반 이름이 카드에 박힌다.
  const classVisible =
    activeClassFilter == null
      ? students
      : students
          .filter((s) => studentInClass(s, activeClassFilter))
          .map((s) =>
            isClassMember(s, activeClassFilter)
              ? { ...s, className: activeClassFilter, tag: activeClassFilter }
              : s,
          );

  // ── 작성 상태 필터(전체/작성/미작성) — 판정은 순수함수(write-filter.ts), 여기선 재료 조립만 ──
  // ⚠️ 반 필터가 걸려 있으면 **그 반 행만** 보고 판정한다. 안 그러면 화면에 보이지도 않는 다른 반 행 때문에
  //    "보이는 행은 다 썼는데 미작성으로 남는" 유령이 생긴다(표 행은 이미 rowInClass로 좁혀져 있다).
  const writtenById: Record<string, boolean> = {};
  for (const s of classVisible) {
    writtenById[s.id] = isStudentWritten(
      s.subjects
        .filter((su) => rowInClass(su, activeClassFilter))
        .map((su) => ({
          draft: reports[s.id]?.[su.name]?.draft,
          sent: reports[s.id]?.[su.name]?.sent,
          attendanceRaw: su.attendanceRaw,
          reportOptout: su.reportOptout,
        })),
    );
  }
  // 🔴 필터는 `visible` 자체를 좁힌다 — 표시 목록과 **일괄 저장·발송·자동작성 대상이 반드시 같은 집합**이어야
  //    한다(일괄 액션은 전부 visible에서 행을 만든다). 표시만 따로 좁히면 "화면엔 12명인데 일괄 발송은 28명"이 된다.
  const visible = applyWriteFilter(classVisible, writeFilter, writtenById, writePins);
  const writeCounts = {
    written: countByWriteFilter(classVisible, "written", writtenById),
    unwritten: countByWriteFilter(classVisible, "unwritten", writtenById),
  };
  // 필터로 목록이 비었을 때의 문구 — 기본 문구("해당 반 학생이 없습니다")는 반 탓을 하는 거짓말이 된다.
  const emptyByWriteFilter =
    writeFilter === "all"
      ? undefined
      : writeFilter === "unwritten"
        ? t("os.c.emptyUnwritten")
        : t("os.c.emptyWritten");
  // 고정(pinned) 덕에 조건과 어긋난 채 남아 있는 학생 수 — 안내줄이 그 사실을 밝히고 '목록 정리'를 준다.
  const staleCount =
    writeFilter === "all"
      ? 0
      : visible.filter((s) => !matchesWriteFilter(writeFilter, writtenById[s.id] === true)).length;
  // 필터를 누른 **그 시점의 대상**을 고정 — 이후 입력으로 상태가 바뀌어도 카드·행이 눈앞에서 사라지지 않는다.
  // 같은 버튼을 다시 누르면 여기서 재계산돼 목록이 정리된다(= 안내줄의 '목록 정리'와 동일 경로).
  function changeWriteFilter(next: WriteFilter) {
    setWriteFilter(next);
    setWritePins(
      next === "all"
        ? new Set<string>()
        : new Set(
            classVisible
              .filter((s) => matchesWriteFilter(next, writtenById[s.id] === true))
              .map((s) => s.id),
          ),
    );
  }
  // 순서변경(3-2)은 단일 반 필터에서만 — 저장 키가 (강사×반)이라 "전체"에선 반이 특정되지 않는다.
  // ⚠️ 동명 반(과목만 다른 같은 이름, 스키마 허용) 가드: 필터는 이름 기반이라 두 반 학생이 섞여 보이는데
  //    첫 반 id로 저장하면 남의 반 학생이 섞인다(리뷰 확정) → 이름 매칭이 유일할 때만 순서 기능 노출.
  const matchingClasses =
    classFilter !== CLASS_TAG_ALL ? todayClasses.filter((c) => c.name === classFilter) : [];
  const orderClass = matchingClasses.length === 1 ? matchingClasses[0] : undefined;
  const effectiveId = visible.some((s) => s.id === selId) ? selId : (visible[0]?.id ?? "");
  const selected = visible.find((s) => s.id === effectiveId) ?? null;
  return {
    selId,
    setSelId,
    classFilter,
    setClassFilter,
    writeFilter,
    view,
    setView,
    activeClassFilter,
    classVisible,
    visible,
    writeCounts,
    emptyByWriteFilter,
    staleCount,
    changeWriteFilter,
    matchingClasses,
    orderClass,
    effectiveId,
    selected,
  };
}
