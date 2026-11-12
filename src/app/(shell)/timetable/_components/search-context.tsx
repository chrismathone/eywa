"use client";
import { useSheetLang } from "@/features/teacher-view/lang-context";
import { useTimetableText } from "@/features/teacher-view/use-timetable-text";

/**
 * 시간표 **학생 검색** 상태 — 툴바(입력)와 세 뷰(기본·통합·강사)가 같은 값을 본다.
 *
 * 원장 지시 2026-08-20: *"시간표에도 학생 검색 기능 추가. 학생 검색하면 해당 학생이 존재하는 수업만
 * 노출되도록."*
 *
 * 🔴 **서버 왕복 0.** 검색은 서버가 이미 그린 명단(`slots[].students[]`) 위에서만 판정한다 — 새 쿼리도,
 *    새 라우팅도 없다. 시간표는 무거운 서버 렌더라 글자마다 라우팅하면 체감이 무너진다(반응속도 1순위).
 *    덤으로 **열람 범위가 넓어지지 않는다**: 강사는 담당 반만 보고, 검색으로 없던 반이 나타나지 않는다([[#77]]).
 * 🔴 **검색어는 저장하지 않는다** — `useState`뿐이고 `users.ui_prefs`·localStorage 어디에도 안 남는다.
 *    다음 방문에 필터가 걸린 채 열리면 "시간표가 비었다"로 읽힌다(출석부 search-context와 같은 규약).
 * 🔴 **URL에도 안 싣는다.** 출석부엔 허브→출석부로 검색어를 들고 가는 씨앗(`?q=`)이 있지만 시간표엔
 *    그런 진입 경로가 없고, 이 화면의 툴바 링크(주 이동·과목·뷰)는 **서버에서 만든 href**라 검색어를
 *    실으면 첫 렌더에 굳어 옛 검색어로 되돌아간다(att-search-seed.ts가 경고하는 바로 그 함정).
 *    파라미터가 없으니 `ParamLink` 네비(같은 라우트)에도 화면 상태만 남아 그대로 이어진다.
 * 🔴 **편집 모드에선 검색이 물러난다.** 안 물러나면 옮길 목적지 반이 필터에 가려 **드롭할 곳이 없는**
 *    편집 모드가 된다("편집이 고장났다"). 그래서 편집 중엔 입력칸을 감추고 필터도 풀며(전 칸 복귀),
 *    편집을 끄면 치던 검색어가 그대로 살아 다시 걸린다.
 * 🔑 필터 단위 = **반(classId)**. 같은 반이 여러 칸(요일·교시)에 나오므로 반으로 잡아야 셀·카드·칩
 *    세 뷰가 같은 답을 본다. 색인은 [`student-search.ts`](@/features/timetable/lib/student-search)가 만든다.
 * ⚠️ 교실뷰는 명단이 아예 클라까지 오지 않는다(payload·PII 축소로 인원 수만 내려간다) → 그 뷰에선
 *    page가 이 공급자를 **아예 안 씌운다**(= 입력칸도 없다. "있는데 안 먹는 것"이 제일 나쁘다).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  emptySearchMessage,
  isSearchActive,
  matchesStudentSearch,
} from "@/features/attendance/student-search";
import {
  SearchScopeChip,
  StudentSearchToggle,
} from "@/features/attendance/components/student-search-box";
import {
  matchedClassIds,
  studentSearchFields,
  type TimetableSearchClass,
  type TimetableSearchStudent,
} from "@/features/timetable/lib/student-search";
import { useTimetableDragging } from "./drag-flag";

/**
 * 검색에 걸린 학생 이름 표식 — **형광펜으로 그은 줄**(형광 노랑 채움 + 진한 글씨).
 *
 * 원장 2026-08-20: *"서치된 학생이 갈색으로 보이는데 영 눈에 안띄네, 다른 색으로 해주고 1초정도 플리커
 * 넣어주면 좋겠는데"* → *"눈에 띄게 형광 계열로 하고 플리커하면 될듯"*. 종전 `bg-amber!`는 **이름만
 * amber이고 실제 값은 갈색**(#995709)이라, 같은 셀의 신입 빨강(bg-danger-soft) 줄 옆에서 묻혔다.
 *
 * 🔑 색·깜빡임의 실체는 [`globals.css`](src/app/globals.css)의 `.search-hit` 한 곳이다(토큰 `--search-hit`).
 *    거기 규칙이 **레이어 밖(unlayered)** 이라 `!important` 없이도 행의 `hover:bg-bg-soft`를 이긴다 —
 *    ① 마우스를 얹어도 표식이 안 지워지고 ② `!important`가 없어 **배경을 애니메이션으로 흔들 수 있다**
 *    (important 선언은 CSS 애니메이션을 이겨 버려서, 종전 `bg-amber!`로는 깜빡임이 아예 불가능했다).
 * 🔑 상태색이 아니라 **찾은 자리** 표식이라 의미색 표(semantic-color)의 상태 tone(green/amber/danger/…)을
 *    빌려 쓰지 않고 전용 토큰을 둔다 — 상태색을 빌리면 그 줄이 "무슨 상태"로 읽힌다.
 */
export const SEARCH_HIT_CLASS = "search-hit font-bold";

/**
 * 깜빡임 **재발화** 장치 — 검색어가 바뀔 때마다 둘을 번갈아 붙인다.
 *
 * 🔴 CSS 애니메이션은 한 번 끝나면 다시 안 돈다. 검색어를 한 글자 더 쳐도 **이미 걸려 있던 줄은 DOM이
 *    그대로**라(칸은 그대로 남고 클래스만 바뀐다) 아무 일도 일어나지 않는다 = 첫 검색만 깜빡인다.
 *    클래스를 a↔b로 갈아 끼우면 animation-name이 바뀌어 브라우저가 **처음부터 다시 재생**한다.
 *    두 클래스는 globals.css에서 이름만 다른 같은 키프레임을 가리킨다.
 */
const SEARCH_FLASH_CLASSES = ["search-hit-flash-a", "search-hit-flash-b"] as const;

const NO_MATCH: ReadonlySet<string> = new Set<string>();

type Ctx = {
  query: string;
  setQuery: (v: string) => void;
  /** 지금 화면에 필터가 걸려 있나 — 공백만 친 것도, 편집 중인 것도 아니다. */
  active: boolean;
  /** 검색에 걸린 반 id — `active`일 때만 의미가 있다. */
  matched: ReadonlySet<string>;
  /** 이 화면(주·과목·구분)에 있는 반 수 — 툴바 칩의 분모. */
  totalClasses: number;
  /** 검색에 걸린 반 수. */
  matchedClasses: number;
  /** 0건일 때 "어디에 없는지" — "이번 주 수학 시간표". */
  scope: string;
  /** 편집 모드라 검색이 물러나 있나(입력칸이 스스로 숨는다). */
  suspended: boolean;
  /**
   * 걸린 줄에 붙일 클래스 — 표식 + **이번 검색어의 깜빡임 클래스**.
   * 검색어가 바뀔 때마다 뒷부분이 a↔b로 바뀌어 애니메이션이 다시 발화한다(위 SEARCH_FLASH_CLASSES).
   */
  hitClass: string;
};

const SearchCtx = createContext<Ctx | null>(null);

/** 공급자가 없으면 null(= 검색이 없는 뷰). 소비처는 그때 **아무것도 안 거른다**. */
export function useTimetableSearch(): Ctx | null {
  return useContext(SearchCtx);
}

export function TimetableSearchProvider({
  index,
  scope,
  enabled = true,
  children,
}: {
  /** 반 단위 검색 색인(서버가 slots에서 만든다). */
  index: TimetableSearchClass[];
  /** 0건 안내가 말할 범위 — "이번 주 수학 시간표". */
  scope: string;
  /**
   * 이 뷰에서 검색이 되나(교실뷰·배치 편집은 false).
   *
   * 🔴 **끄는 것으로 충분하지 않고 필터까지 풀어야 한다** — 뷰 전환은 같은 라우트라 공급자가 remount되지
   *    않아 치던 검색어가 그대로 남는다. 그 상태로 교실뷰에 들어가면 색인이 비어 "찾지 못했습니다"만
   *    뜨고(그 뷰엔 명단이 없어 당연히 0건) 지울 입력칸도 없다. 꺼진 뷰에선 검색이 **없던 일**이 되고,
   *    돌아오면 그대로 되살아난다.
   */
  enabled?: boolean;
  children: ReactNode;
}) {
  // 검색어와 **깜빡임 세대(flash)** 를 한 상태로 묶는다 — 세대는 검색어가 실제로 바뀐 그 순간에만
  // 오른다. 렌더 중 setState도, 효과([[#25]] set-state-in-effect 금지)도 쓰지 않고 입력 이벤트
  // 한 자리에서 함께 올리므로 "검색어는 바뀌었는데 깜빡임은 안 바뀐" 상태가 생기지 않는다.
  const [{ query, flash }, setState] = useState({ query: "", flash: 0 });
  const setQuery = useCallback((v: string) => {
    setState((s) => (s.query === v ? s : { query: v, flash: s.flash + 1 }));
  }, []);
  // **끄는 동안**엔 필터를 푼다 — 위 주석의 "드롭할 곳이 없는" 상태 방지(옛 편집 모드가 하던 몫).
  // ⚠️ 권한(canDrag)으로 풀면 관리자에겐 검색이 영영 안 걸린다 — 판정은 실제 드래그 중인지다.
  // ⚠️ **검색어가 걸려 있을 때만 구독**한다 — 평소(검색 없음)엔 픽업에 이 provider가 안 깨어난다(드래그 렉).
  const dragging = useTimetableDragging(enabled && isSearchActive(query));
  const active = enabled && isSearchActive(query) && !dragging;
  const matched = useMemo(
    () => (active ? matchedClassIds(index, query) : NO_MATCH),
    [active, index, query],
  );
  const value = useMemo<Ctx>(
    () => ({
      query,
      setQuery,
      active,
      matched,
      totalClasses: index.length,
      matchedClasses: matched.size,
      scope,
      suspended: dragging || !enabled,
      hitClass: `${SEARCH_HIT_CLASS} ${SEARCH_FLASH_CLASSES[flash % SEARCH_FLASH_CLASSES.length]}`,
    }),
    [query, setQuery, active, matched, index.length, scope, dragging, enabled, flash],
  );
  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}

/**
 * 이 칸(반 하나 또는 합반 여러 반)을 그릴까 — **안 걸리면 아예 안 그린다**(숨김 아님).
 * 공급자가 없거나 필터가 안 걸려 있으면 항상 참(검색을 모르는 화면이 통째로 사라지지 않게).
 */
export function useClassVisible(classIds: readonly (string | null | undefined)[]): boolean {
  const ctx = useTimetableSearch();
  if (!ctx?.active) return true;
  return classIds.some((id) => !!id && ctx.matched.has(id));
}

/**
 * 목록을 거를 때(통합뷰 카드처럼 반이 줄줄이 있는 자리) — 훅은 한 번만 부르고 판정만 반복한다.
 * 필터가 안 걸려 있으면 **항상 참**(검색을 모르는 화면이 통째로 사라지지 않게).
 */
export function useClassFilter(): (classId: string | null | undefined) => boolean {
  const ctx = useTimetableSearch();
  const active = ctx?.active ?? false;
  const matched = ctx?.matched ?? NO_MATCH;
  return useCallback(
    (classId) => !active || (!!classId && matched.has(classId)),
    [active, matched],
  );
}

/**
 * 검색에 안 걸린 칸을 **그리지 않는** 껍데기 — children은 서버가 이미 만든 마크업이라 여기서 다시
 * 렌더되지 않는다(검색어가 바뀌어도 싸다).
 *
 * ⚠️ 격자(교시 행·요일 열)는 그대로 둔다 — 칸의 **내용만** 사라진다. 축까지 접으면 "몇 교시 자리인지"가
 *    무너져 검색 결과의 위치를 못 읽는다.
 * ⚠️ `classIds`가 빈 배열이면 검색 중엔 항상 숨는다 — 반이 아닌 칸(강사뷰의 감독·준비 블록)이 그렇다.
 */
export function SearchedCell({
  classIds,
  children,
}: {
  classIds: readonly (string | null | undefined)[];
  children: ReactNode;
}) {
  const visible = useClassVisible(classIds);
  if (!visible) return null;
  return <>{children}</>;
}

/**
 * 이 학생 줄의 최종 색 — 검색에 걸리면 **평소 tone을 대신한다**(덧붙이는 게 아니다).
 *
 * 🔑 색인과 **같은 필드 함수**(studentSearchFields)로 판정한다 — 다르면 "칸은 떴는데 강조된 이름이
 *    없다"가 된다.
 * 🔴 **대체**인 이유(2026-08-20 실측): 덧붙이면 tone과 표식이 같은 속성을 다투고 승자는 **생성된 CSS
 *    순서**가 정한다. 퇴원 행(`bg-ink/80!`)이 표식(`bg-amber!`)을 이겨 **검색에 걸렸는데 아무 표시도
 *    안 나왔다**(둘 다 important라 important로는 못 이긴다). 대체하면 그 다툼 자체가 없다.
 * ⚠️ 그 대가로 검색 중엔 신입 빨강·퇴원 회색이 그 줄에서 잠시 안 보인다 — 대신 섹션 라벨(대기·퇴원)과
 *    hover 카드가 그대로라 정보가 사라지진 않는다. 지금은 "누구를 찾았나"가 먼저다.
 * 🔴 **대체는 이제 더 필수다**: 표식에서 `!important`를 걷어냈으므로(깜빡임을 위해) 덧붙이면 `!`가 붙은
 *    tone(`bg-ink/80!`)이 **확실히 이긴다** — 예전엔 important끼리 순서 다툼이었지만 지금은 다툴 것도 없다.
 * 🔑 표식 문자열은 공급자가 준다(`ctx.hitClass`) — 깜빡임 클래스가 검색어마다 달라야 해서 상수만으로는
 *    부족하다. 세 뷰(기본·통합·강사)가 이 훅 하나를 쓰므로 색·깜빡임이 저절로 같이 간다.
 */
export function useSearchTone(student: TimetableSearchStudent, tone: string): string {
  const ctx = useTimetableSearch();
  if (!ctx?.active) return tone;
  return matchesStudentSearch(ctx.query, studentSearchFields(student)) ? ctx.hitClass : tone;
}

/**
 * 툴바 검색칸 — 늘 펼친 입력칸(+지금 걸린 필터 표기). 원장 2026-11-11 '닫기' 제거(공용 [`SearchToggle`](@/components/search-toggle)과 같다).
 * 이 검색은 URL이 아니라 클라 상태라 그쪽 부품(SearchForm = router.push)을 못 쓰고 [`StudentSearchToggle`](@/features/attendance/components/student-search-box)을 쓴다.
 * ⚠️ 입력칸이 숨는 상황(편집 모드·반 0개)엔 통째로 사라진다 — 구분선을 따로 안 그리는 이유.
 */
export function TimetableSearchToggle() {
  const tt = useTimetableText();
  const ctx = useTimetableSearch();
  if (!ctx || ctx.suspended || ctx.totalClasses === 0) return null;
  return (
    <StudentSearchToggle
      value={ctx.query}
      onChange={ctx.setQuery}
      chip={<SearchScopeChip shown={ctx.matchedClasses} total={ctx.totalClasses} unit={tt("개 수업")} totalsNote={tt("상단 인원 집계는 전체 기준")} />}
    />
  );
}

/**
 * 0건 — **왜 비었는지 한 줄로 밝힌다.** 빈 격자만 남기면 "시간표가 고장났다"로 읽힌다.
 * 범위(주·과목)만 말하고 권한 이야기는 하지 않는다(검색은 보고 있던 화면만 좁힌다).
 */
export function TimetableSearchEmptyNote() {
  const lang = useSheetLang();
  const tt = useTimetableText();
  const ctx = useTimetableSearch();
  if (!ctx?.active || ctx.matchedClasses > 0) return null;
  return (
    <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
      <span className="text-foreground text-sm font-bold break-keep">
        {lang === "en" ? `No classes match “${ctx.query}” in this timetable.` : emptySearchMessage(ctx.query, ctx.scope)}
      </span>
      <button
        type="button"
        onClick={() => ctx.setQuery("")}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition"
      >
        {tt("검색 지우기")}</button>
    </div>
  );
}

/**
 * "N개 수업" — 검색 중엔 **보이는 수/전체**로 적는다. 안 그러면 카드 한 장만 남은 화면이 "42개 수업"이라고
 * 말해 머리글이 거짓말을 한다.
 */
export function VisibleClassCount({ total }: { total: number }) {
  const ctx = useTimetableSearch();
  const text = ctx?.active ? `${ctx.matchedClasses}/${total}` : `${total}`;
  return <span className="num">{text}</span>;
}
