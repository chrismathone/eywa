import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Toolbar } from "@/components/toolbar";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { addDays } from "@/lib/date-kst";
import {
  ONESCREEN_FONT_SIZES,
  ONESCREEN_FONT_SIZE_LABEL,
  type OnescreenFontSize,
} from "../font-size";
import type { OneScreenView } from "../view";
import type { WriteFilter } from "../write-filter";
import type { TodayClass } from "../server/roster";
import { REPORT_OPTOUT_NOTICE } from "@/features/classes/report-optout";

/**
 * 원스크린 상단 바 — 날짜 + 반 필터 + 오늘 수업 + 마감 통계 + 카드/표 토글을 **한 줄(반응형)**로.
 * 예전 TopBar+HubBar 2개 카드를 하나의 flex-wrap 바로 합침 — 넓은 화면은 1줄, 좁으면 자연 wrap(불필요한 2줄 제거).
 *
 * 📱 **모바일은 wrap이 아니라 2줄 레일**(2026-08-20 원장 제보 *"모바일뷰 정렬이 너무 안되어있음"*).
 *    폰(390px)에선 컨트롤이 7줄로 감겨 본문 전에 **301px**을 먹었고, 순서도 중요도와 반대였다(뷰 탭이 맨
 *    아래, 한 번 정하면 끝인 글씨 크기가 그 위). → 시간표 툴바와 같은 `.toolbar-rail` 규약으로 **감는 대신
 *    눕히고**(컨트롤은 하나도 안 숨긴다) 두 줄로 나눈다. 실측 **301px → 92px**.
 *    · 줄 ② = 출결 모드 · 뷰 탭 — `rail-row-first`로 맨 위(합쳐 ~310px라 폰에서 스크롤 없이 다 보인다)
 *    · 줄 ① = 날짜 · 반/작성 필터 · 진행 통계 · 보강 추가 · 공지 모드 · 글씨 크기(뒤로 갈수록 드물게 만짐)
 * ⚠️ 데스크톱·창(≥1024 + 정밀 포인터)은 **종전 그대로** 감긴다 — 줄 래퍼가 `display: contents`로 사라져
 *    DOM 순서(=예전 순서)가 그대로 배치된다. 그래서 **JSX 순서를 바꾸면 데스크톱이 바뀐다**: 모바일에서만
 *    앞으로 당기고 싶으면 항목이 아니라 **줄에** `rail-row-first`를 준다(globals.css 주석 참조).
 */
export function OneScreenTopBar({
  today,
  date,
  todayYmd,
  onDateChange,
  classTags,
  classFilter,
  onFilter,
  writeFilter,
  writeCounts,
  onWriteFilter,
  doneCount,
  total,
  view,
  onView,
  stats,
  todayClasses,
  noticeMode,
  academyNoticeMode,
  onNoticeMode,
  fontSize,
  onFontSize,
  makeupAdder,
  readonlyView = false,
}: {
  today: string;
  date: string; // 대상 날짜(YYYY-MM-DD)
  todayYmd: string; // KST 오늘(YYYY-MM-DD) — 다음날 이동 상한
  onDateChange: (ymd: string) => void; // 날짜 이동(searchParam 네비)
  classTags: readonly string[];
  classFilter: string;
  onFilter: (tag: string) => void;
  writeFilter: WriteFilter; // 작성 상태 필터(전체/작성/미작성)
  writeCounts: { written: number; unwritten: number }; // 지금 조건에 맞는 학생 수(실시간)
  onWriteFilter: (f: WriteFilter) => void; // 같은 값을 다시 누르면 목록 재계산(정리)
  doneCount: number;
  total: number;
  view: OneScreenView;
  onView: (v: OneScreenView) => void;
  stats: { students: number; progressDone: number; testDone: number; reportDone: number };
  todayClasses: TodayClass[];
  noticeMode: "A" | "B" | null; // 강사 본인 멘트 모드(null=학원 기본)
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드
  onNoticeMode: (mode: "A" | "B" | null) => void;
  fontSize: OnescreenFontSize; // 글씨 크기(내 계정) — 아래 목록·표를 통째로 확대
  onFontSize: (size: OnescreenFontSize) => void;
  makeupAdder?: ReactNode; // 보강 학생 추가 컨트롤(슬롯)
  /** '다른 강사 뷰'(열람 전용) — 공지 탭(순수 작성 화면)을 숨긴다(2026-08-19). */
  readonlyView?: boolean;
}) {
  // 작성 상태 필터 — 순서는 원장 표현대로 전체 → 작성 → 미작성. 숫자는 **지금 조건에 맞는 학생 수**라
  // 고정(pinned)으로 화면에 남아 있는 학생과 다를 수 있다(그래서 아래 안내줄이 그 차이를 밝힌다).
  const writeOptions: { value: WriteFilter; label: string; count?: number }[] = [
    { value: "all", label: "전체" },
    { value: "written", label: "작성", count: writeCounts.written },
    { value: "unwritten", label: "미작성", count: writeCounts.unwritten },
  ];
  // 시각 칩으로 못 덮는 태그(todayClasses 없이 classTags만 오는 호출부 방어) — 보통은 빈 배열.
  const timedNames = new Set(todayClasses.map((c) => c.name));
  const extraTags = classTags.filter((t) => t !== "전체" && !timedNames.has(t));
  // 내 반 / 위임받은 반(0173a) 분리 — 각 그룹 안의 시각순 정렬은 서버가 이미 해놨다(roster.ts).
  const ownClasses = todayClasses.filter((c) => !c.delegated);
  const delegatedClasses = todayClasses.filter((c) => c.delegated);
  const noticeOptions: { value: "A" | "B" | null; label: string }[] = [
    { value: null, label: `학원 기본(${academyNoticeMode})` },
    { value: "A", label: "단일 A" },
    { value: "B", label: "2문단 B" },
  ];
  const dateRef = useRef<HTMLInputElement>(null);
  const isToday = date >= todayYmd; // 오늘(또는 이상) = 다음날 이동 막고 '오늘' 버튼 숨김
  return (
    <Toolbar rail={false} gap="gap-x-3 gap-y-2">
      {/* ── 줄 ①(데스크톱 순서 그대로) — 날짜 · 반/작성 필터 · 진행 통계 · 드물게 만지는 설정.
             모바일에선 아래 줄 ②가 위로 올라가므로 **화면에선 두 번째 줄**이다(rail-row-first). */}
      <div className="toolbar-rail toolbar-rail-row items-center gap-x-2">
        {/* 날짜 — 이전/다음 이동 + 날짜 선택(과거 날짜 마감·재발송). report_date=카드 표시일=ClassNote 게시일. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="bg-primary-soft text-primary flex size-7 items-center justify-center rounded-sm">
            <EyIcon name="check" size={14} />
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onDateChange(addDays(date, -1))}
              aria-label="이전 날짜"
              className="text-text-dim hover:bg-bg-soft inline-flex h-8 w-7 items-center justify-center rounded-md"
            >
              <EyIcon name="chevronLeft" size={16} />
            </button>
            <div className="min-w-[128px] text-center">
              <p className="micro text-text-faint">{isToday ? "수업 마감" : "지난 마감"}</p>
              {/* 날짜 클릭 = 달력 열기.
                  🔴 예전엔 투명 `<input type="date">`를 겹쳐 두기만 했는데, 크로미움은 **달력 아이콘
                  (::-webkit-calendar-picker-indicator)을 눌러야** 달력이 열린다 — 투명 입력의 가운데를
                  누르면 포커스만 가고 아무 일도 안 일어났다(원장 제보 2026-07-23 "달력뷰가 안 되는 것 같네").
                  → ① 클릭 때 `showPicker()`를 직접 호출하고, ② 달력 아이콘을 입력 전체로 늘려 어디를 눌러도
                  열리게 이중으로 보장한다(showPicker 미지원 브라우저 폴백). */}
              <label
                className="relative block cursor-pointer"
                onClick={() => {
                  // showPicker는 사용자 제스처 밖이거나 미지원이면 throw — 실패해도 아래 CSS 폴백이 받는다.
                  try {
                    dateRef.current?.showPicker?.();
                  } catch {
                    /* 폴백: 달력 아이콘이 입력 전체를 덮고 있어 이 클릭이 그대로 picker를 연다 */
                  }
                }}
              >
                <p className="text-foreground text-[13px] font-bold">{today}</p>
                <input
                  ref={dateRef}
                  type="date"
                  value={date}
                  max={todayYmd}
                  onChange={(e) => e.target.value && onDateChange(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  aria-label="날짜 선택"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => onDateChange(addDays(date, 1))}
              disabled={isToday}
              aria-label="다음 날짜"
              className="text-text-dim hover:bg-bg-soft inline-flex h-8 w-7 items-center justify-center rounded-md disabled:opacity-30"
            >
              <EyIcon name="chevronRight" size={16} />
            </button>
            {!isToday ? (
              <button
                type="button"
                onClick={() => onDateChange(todayYmd)}
                className="border-line text-primary hover:bg-bg-soft ml-1 inline-flex h-8 items-center rounded-lg border px-2 text-xs font-medium"
              >
                오늘
              </button>
            ) : null}
          </div>
        </div>

        <span className="bg-line hidden h-5 w-px shrink-0 sm:block" aria-hidden />

        {/* 반 필터 = '오늘 수업' 칩 하나로 통합(2026-07-27 원장: "수업명이 2줄로 겹치는데 굳이 2개나?").
            예전엔 ① 반 이름만 있는 필터 줄 + ② 시각·인원이 붙은 '오늘' 정보 줄이 따로 있었는데,
            서버가 `classTags = ["전체", ...todayClasses 이름]`으로 **같은 원본에서** 만들기 때문에 두 줄은
            항상 같은 목록이었다(roster.ts). → 정보가 많은 쪽(시각·인원)을 남기고 그걸 클릭 가능한 필터로.
            ⚠️ todayClasses 없이 classTags만 오는 호출부(데모 등)를 위해 남는 태그는 이름 칩으로 계속 렌더한다. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onFilter("전체")}
            aria-pressed={classFilter === "전체"}
            className={`${TOOLBAR_CHIP} ${classFilter === "전체" ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
          >
            전체
          </button>
          {ownClasses.map((c) => (
            <ClassChip key={c.id} c={c} on={c.name === classFilter} onFilter={onFilter} />
          ))}
          {/* 위임받은 반(0173a)은 **내 반과 섞지 않는다** — 뒤로 모으고 앰버로 갈라 놓는다(원장 지시 2026-08-03
              "기존 내 반과 구분해서 위임 반 목록이 나오도록 디자인적으로도 구분"). 같은 색으로 줄세우면
              남의 반 학생에게 내 반처럼 보고서를 쓰게 되고, 그건 학부모에게 나간 뒤에야 드러난다. */}
          {delegatedClasses.length > 0 ? (
            <>
              <span className="bg-line h-4 w-px shrink-0" aria-hidden />
              <span
                className="text-amber text-[11px] font-bold"
                title="결근한 선생님 대신 이 기간에만 맡은 반입니다"
              >
                위임
              </span>
            </>
          ) : null}
          {delegatedClasses.map((c) => (
            <ClassChip key={c.id} c={c} on={c.name === classFilter} onFilter={onFilter} />
          ))}
          {extraTags.map((tag) => {
            const on = tag === classFilter;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onFilter(tag)}
                aria-pressed={on}
                className={`${TOOLBAR_CHIP} ${on ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
              >
                {tag}
              </button>
            );
          })}
        </div>

        {/* 작성 상태 필터 — "아직 안 쓴 학생만" 추려 마저 쓰기 위한 것(반 필터 바로 옆 = 둘 다 '무엇을 보여줄지').
            판정은 학부모 문구 기준(write-filter.ts). 같은 값을 다시 누르면 목록을 새로 계산한다. */}
        <div
          className={TOOLBAR_SEG_BOX}
          title="학부모 문구 기준 — 모든 행에 문구가 있거나 이미 발송됐으면 '작성', 한 행이라도 비어 있으면 '미작성'입니다(결석 행은 발송 대상이 아니라 판정에서 제외). 필터를 켠 뒤 입력해도 카드·행이 사라지지 않으며, 같은 버튼을 다시 누르면 목록을 정리합니다."
        >
          {writeOptions.map((o) => {
            const on = writeFilter === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onWriteFilter(o.value)}
                aria-pressed={on}
                className={`${TOOLBAR_SEG_ITEM} ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {o.label}
                {o.count != null ? (
                  <span className={`tabular ml-1 ${on ? "" : "text-text-faint"}`}>{o.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* 우측: 마감 통계 + 카드/표 토글 */}
        <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <div className="text-text-dim flex items-center gap-x-2.5 text-[12px]">
            <span>
              학생 <b className="text-foreground tabular">{stats.students}</b>
            </span>
            <span>
              진도 <b className="text-primary tabular">{stats.progressDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span>
              테스트 <b className="text-blue tabular">{stats.testDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span>
              발송 <b className="text-gold tabular">{stats.reportDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span className="border-line rounded-full border px-1.5 py-0.5">
              마감 <b className="text-foreground tabular">{doneCount}</b>
              <span className="text-text-faint">/{total}</span>
            </span>
          </div>
          {makeupAdder}
          {/* AI 멘트 모드(내 계정) — 학원 기본 / 단일 A / 2문단 B. 강사별 저장(users.report_notice_mode).
              바꾸면 아래 보고서 입력이 1칸(A) ↔ 2칸(B, 수업 내용 / 태도·특이사항)으로 함께 바뀐다. */}
          <div
            className={TOOLBAR_SEG_BOX}
            title="학부모 멘트 문단 구성(내 계정) — A는 한 문단, B는 '수업 내용'과 '태도·특이사항' 2문단. 아래 보고서 입력칸과 자동 작성 결과가 함께 바뀝니다."
          >
            {noticeOptions.map((o) => {
              const on = noticeMode === o.value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => onNoticeMode(o.value)}
                  aria-pressed={on}
                  className={`${TOOLBAR_SEG_ITEM} ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <span className="bg-line h-5 w-px" aria-hidden />
          {/* 글씨 크기(내 계정) — 원장 지시 2026-07-30. 지금 크기가 '작음'이라 기본은 화면 무변경.
              표뷰는 칸마다 px 글자가 박힌 조밀한 스프레드시트라 **표 전체를 같은 비율로** 확대한다
              (글자만 키우면 칸·체크박스와 어긋난다). 저장은 계정 = 다른 PC에서도 같은 크기. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="micro shrink-0">글씨 크기</span>
            <div
              className={TOOLBAR_SEG_BOX}
              title="아래 목록·표의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다"
            >
              {ONESCREEN_FONT_SIZES.map((s) => {
                const on = fontSize === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onFontSize(s)}
                    aria-pressed={on}
                    className={`${TOOLBAR_SEG_ITEM} ${on ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
                  >
                    {ONESCREEN_FONT_SIZE_LABEL[s]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── 줄 ②: 출결 모드 · 뷰 탭 = **폰에서 가장 자주 누르는 것**이라 `rail-row-first`로 맨 위에.
             둘이 합쳐 ~310px라 390px 폰에서 **가로 스크롤 없이** 다 보인다(줄 ①은 날짜부터 시작).
          ⚠️ DOM 순서는 데스크톱 순서 그대로다 — 줄을 통째로 올릴 뿐 항목을 재정렬하지 않는다
             (globals.css `.toolbar-rail-row` 주석: order를 항목마다 뿌리면 탭 이동 순서가 갈린다). */}
      <div className="toolbar-rail toolbar-rail-row rail-row-first items-center gap-x-2">
        {/* 출결 모드(2026-08-20) — 강사 홈에서 출결만 빠르게 찍는 별도 화면으로.
            🔴 **여기가 폰의 유일한 입구다** — 모바일엔 사이드바가 없어 하부탭(SUBTABS_BY_MENU)에만 두면
               갈 길이 아예 없다(셔틀에서 겪은 그대로). 뷰 토글과 달리 라우트 이동이라 Link다.
            🔴 **채운 버튼**이다 — 회색 외곽선이면 옆 글씨 크기·뷰 토글과 구분되지 않아 원장이 못 찾았다
               (2026-08-20 *"어딨지?"*). 이 줄에서 유일하게 라우트를 옮기는 버튼이라 색이 그 사실을 말한다.
            ⚠️ 열람 전용('다른 강사 뷰')에선 숨긴다 — 그 화면은 저장이 전부 거절되므로 데려가 봐야
               누를 수 없는 버튼만 보여 준다(공지 탭을 숨기는 것과 같은 결). */}
        {readonlyView ? null : (
          <Link
            href="/attendance/quick"
            title="오늘 내 수업의 출결만 터치로 빠르게 입력합니다"
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition"
          >
            출결 모드
          </Link>
        )}
        {/* 카드 ↔ 표(스프레드시트) ↔ 오늘 발송 현황 ↔ 월간 발송(달력) ↔ 공지 뷰 전환 */}
        <div className={TOOLBAR_SEG_BOX}>
          {/* 열람 전용은 공지 탭 제외 — 공지는 순수 작성 화면이라 열람에서 열 이유가 없다(진입 가드와 짝). */}
          {(readonlyView
            ? (["card", "grid", "status", "history"] as const)
            : (["card", "grid", "status", "history", "notice"] as const)
          ).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              aria-pressed={view === v}
              // 레일(가로 스크롤) 안이라 `whitespace-nowrap` — '발송 현황'·'월간 발송'이 두 줄로 접히면
              // 그 줄만 키가 두 배가 된다(칩 폭이 아니라 **줄 높이**가 크롬을 먹는다).
              className={`${TOOLBAR_SEG_ITEM} whitespace-nowrap ${
                view === v ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF
              }`}
            >
              {v === "card"
                ? "카드"
                : v === "grid"
                  ? "표"
                  : v === "status"
                    ? "발송 현황"
                    : v === "history"
                      ? "월간 발송"
                      : "공지"}
            </button>
          ))}
        </div>
      </div>
    </Toolbar>
  );
}

/**
 * 반 필터 칩 한 개 — 내 반과 **위임받은 반**(0173a)이 같은 모양을 쓰되 색으로 갈린다.
 * 위임 반은 앰버(주의색) + 원 담임 이름을 툴팁으로 밝힌다: 지금 보고 있는 학생들이 남의 반 학생이라는
 * 사실이 화면에서 먼저 보여야, 내 반인 줄 알고 쓴 보고서가 학부모에게 나가는 일이 없다.
 */
function ClassChip({
  c,
  on,
  onFilter,
}: {
  c: TodayClass;
  on: boolean;
  onFilter: (tag: string) => void;
}) {
  const base = `${TOOLBAR_CHIP} gap-1 whitespace-nowrap`;
  // ⚠️ 위임 반은 앰버 — 톤만 갈리고 **모양(높이·라운드·테두리)은 툴바 칩 그대로**다.
  const tone = c.delegated
    ? on
      ? "border-amber bg-amber text-white"
      : "border-amber bg-amber-soft text-amber hover:bg-amber/15"
    : on
      ? TOOLBAR_CHIP_ON
      : TOOLBAR_CHIP_OFF;
  const timeTone = on
    ? c.delegated
      ? "text-white/75"
      : "text-primary-foreground/75"
    : c.delegated
      ? "text-amber"
      : "text-primary";
  const countTone = on
    ? c.delegated
      ? "text-white/75"
      : "text-primary-foreground/75"
    : c.delegated
      ? "text-amber/70"
      : "text-text-faint";
  return (
    <button
      type="button"
      onClick={() => onFilter(c.name)}
      aria-pressed={on}
      // 스크린리더도 색을 못 보는 대신 이 라벨로 안다 — 시각 구분과 같은 사실을 말한다.
      aria-label={
        c.delegated
          ? `${c.name} — ${c.ownerName ? `${c.ownerName} 선생님 반` : "다른 선생님 반"}, 위임받음`
          : c.delegatedAwayTo
            ? `${c.name} — ${c.delegatedAwayTo} 선생님에게 위임 중`
            : undefined
      }
      title={
        c.delegated
          ? `${c.ownerName ? `${c.ownerName} 선생님 반` : "다른 선생님 반"} — 이 기간에만 대신 맡은 위임 반입니다`
          : c.delegatedAwayTo
            ? `이 날짜에는 ${c.delegatedAwayTo} 선생님이 대신 맡습니다 — 직접 쓰실 수도 있지만 둘이 각자 쓰면 나중에 쓴 쪽이 남습니다`
            : c.reportOptout
              ? REPORT_OPTOUT_NOTICE
              : undefined
      }
      className={`${base} ${tone}`}
    >
      <span className={`font-mono text-[10px] font-bold ${timeTone}`}>{c.startTime ?? "—"}</span>
      <span className={on ? "" : c.delegated ? "" : "text-foreground"}>{c.name}</span>
      {/* '수업보고서 미발송' 반 — 눌러서 보고서 칸이 잠긴 걸 보기 **전에** 알린다(2026-08-19). */}
      {c.reportOptout ? (
        <span className={on ? "text-primary-foreground/75" : "text-text-faint"} aria-hidden>
          출결만
        </span>
      ) : null}
      {/* 내 반이 남에게 넘어간 날 — 반을 숨기지 않고 표식만 단다(권한은 그대로, 원 담임도 쓸 수 있다). */}
      {c.delegatedAwayTo ? (
        <span className={on ? "text-primary-foreground/75" : "text-amber"} aria-hidden>
          위임중
        </span>
      ) : null}
      <span className={countTone}>{c.studentCount}</span>
    </button>
  );
}
