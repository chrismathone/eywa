import type { ReactNode } from "react";
import Link from "next/link";
import { DatePickerButton } from "@/components/date-picker-button";
import { HrefSelect } from "@/components/href-select";
import { PeriodNav } from "@/components/period-nav";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { addDays, DAY_LABEL_W } from "@/lib/date-kst";
import {
  ONESCREEN_FONT_SIZES,
  onescreenFontSizeLabel,
  type OnescreenFontSize,
} from "../font-size";
import { CLASS_TAG_ALL } from "../class-tags";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { CLASSNOTE_ONLY_VIEWS, type OneScreenView } from "../view";
import type { WriteFilter } from "../write-filter";
import type { TodayClass } from "../server/roster";
import { reportOptoutNotice } from "@/features/classes/report-optout";

/**
 * 원스크린 상단 바 — 날짜 + 반 필터 + 오늘 수업 + 마감 통계 + 카드/표 토글을 **한 줄(반응형)**로.
 * 예전 TopBar+HubBar 2개 카드를 하나의 flex-wrap 바로 합침 — 넓은 화면은 1줄, 좁으면 자연 wrap(불필요한 2줄 제거).
 *
 * 📱 **모바일은 wrap이 아니라 2줄 레일**(2026-08-20 원장 제보 *"모바일뷰 정렬이 너무 안되어있음"*).
 *    폰(390px)에선 컨트롤이 7줄로 감겨 본문 전에 **301px**을 먹었고, 순서도 중요도와 반대였다(뷰 탭이 맨
 *    아래, 한 번 정하면 끝인 글씨 크기가 그 위). → 시간표 툴바와 같은 `.toolbar-rail` 규약으로 **감는 대신
 *    눕히고**(컨트롤은 하나도 안 숨긴다) 두 줄로 나눈다. 실측 **301px → 92px**.
 *    · 줄 ② = 출결 모드 · 보기 드롭다운 — `rail-row-first`로 맨 위(합쳐 ~310px라 폰에서 스크롤 없이 다 보인다)
 *    · 줄 ① = 날짜 · 반/작성 필터 · 진행 통계 · 보강 추가 · 공지 모드 · 글씨 크기(뒤로 갈수록 드물게 만짐)
 * ⚠️ 데스크톱·창(≥1024 + 정밀 포인터)은 **종전 그대로** 감긴다 — 줄 래퍼가 `display: contents`로 사라져
 *    DOM 순서(=예전 순서)가 그대로 배치된다. 그래서 **JSX 순서를 바꾸면 데스크톱이 바뀐다**: 모바일에서만
 *    앞으로 당기고 싶으면 항목이 아니라 **줄에** `rail-row-first`를 준다(globals.css 주석 참조).
 *
 * 디자인 v5 18단계(강사뷰, 2026-09-04, 지시서 §10): 날짜 = 앱 전역 `PeriodNav`(라벨 클릭 = 오늘) + 달력 아이콘(날짜 선택) ·
 * 작성 상태·멘트·글씨·보기 세그먼트 → `축: 값` 드롭다운(`HrefSelect` 값 모드) · '출결 모드' = Primary `<Button>` ·
 * 통계 글자 16. 🔴 **반 칩은 남긴다** — 시각·인원·위임(앰버) 표식을 나르는 이 화면의 주 스위치라 드롭다운으로 접으면
 * 위임 반이 남의 반이라는 사실이 트리거에서 사라진다(원장 2026-08-03 "디자인적으로도 구분").
 */
// 면 이름은 **사전 키**만 든다 — 문구는 사전 한 곳이라 화면 언어를 따라간다(v5 드롭다운 라벨도 이 표를 쓴다).
const VIEW_LABEL_KEY: Record<OneScreenView, "os.face.card" | "os.face.table" | "os.face.sendStatus" | "os.face.monthly" | "os.face.notice"> = {
  card: "os.face.card",
  grid: "os.face.table",
  status: "os.face.sendStatus",
  history: "os.face.monthly",
  notice: "os.face.notice",
};

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
  classnoteOn = true,
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
  /** ClassNote 기능(모듈) 켜짐 — 꺼지면 발송 현황·월간 발송·공지 뷰를 목록에서 뺀다. */
  classnoteOn?: boolean;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  // 작성 상태 필터 — 순서는 원장 표현대로 전체 → 작성 → 미작성. 숫자는 **지금 조건에 맞는 학생 수**라
  // 고정(pinned)으로 화면에 남아 있는 학생과 다를 수 있다(그래서 아래 안내줄이 그 차이를 밝힌다).
  const writeOptions: { value: WriteFilter; label: string; count?: number }[] = [
    { value: "all", label: t("os.write.all") },
    { value: "written", label: t("os.write.written"), count: writeCounts.written },
    { value: "unwritten", label: t("os.write.unwritten"), count: writeCounts.unwritten },
  ];
  // 시각 칩으로 못 덮는 태그(todayClasses 없이 classTags만 오는 호출부 방어) — 보통은 빈 배열.
  const timedNames = new Set(todayClasses.map((c) => c.name));
  // ⚠️ 콜백 인자를 `t`로 두면 번역 함수를 가린다 — 이름을 갈라 둔다.
  const extraTags = classTags.filter((tag) => tag !== CLASS_TAG_ALL && !timedNames.has(tag));
  // 내 반 / 위임받은 반(0173a) 분리 — 각 그룹 안의 시각순 정렬은 서버가 이미 해놨다(roster.ts).
  const ownClasses = todayClasses.filter((c) => !c.delegated);
  const delegatedClasses = todayClasses.filter((c) => c.delegated);
  const noticeOptions: { value: "A" | "B" | null; label: string }[] = [
    { value: null, label: tf("os.ment.academy", { mode: academyNoticeMode }) },
    { value: "A", label: t("os.ment.a") },
    { value: "B", label: t("os.ment.b") },
  ];
  const isToday = date >= todayYmd; // 오늘(또는 이상) = 다음날 이동 막고 '오늘' 버튼 숨김
  return (
    <Toolbar rail={false} gap="gap-x-3 gap-y-2">
      {/* ── 줄 ①(데스크톱 순서 그대로) — 날짜 · 반/작성 필터 · 진행 통계 · 드물게 만지는 설정.
             모바일에선 아래 줄 ②가 위로 올라가므로 **화면에선 두 번째 줄**이다(rail-row-first). */}
      <div className="toolbar-rail toolbar-rail-row items-center gap-x-2">
        {/* 날짜 — 이전/다음 이동 + 날짜 선택(과거 날짜 마감·재발송). report_date=카드 표시일=ClassNote 게시일.
            PeriodNav는 href 대신 **날짜 문자열**을 받고 `onNavigate`가 가로채 `onDateChange`로 넘긴다(searchParam 네비는 호출부 몫).
            오늘 이후로는 못 간다(`nextDisabled`) — 옛 규칙 그대로. */}
        <div className="flex shrink-0 items-center gap-1.5" data-help="os-date">
          {/* 라벨은 호출부가 만든 문자열(`today` = "2026년 9월 4일 (금)") — PeriodNav 규약(포맷은 호출부 단일 소스). */}
          <PeriodNav
            label={today}
            prevHref={addDays(date, -1)}
            nextHref={addDays(date, 1)}
            currentHref={todayYmd}
            relation={date === todayYmd ? "current" : date < todayYmd ? "past" : "future"}
            prevAriaLabel={t("os.date.prev")}
            nextAriaLabel={t("os.date.next")}
            currentTitle={t("nav.today")}
            nextDisabled={isToday}
            onNavigate={(ymd) => onDateChange(ymd)}
            labelWidth={DAY_LABEL_W}
          />
          {/* 달력 열기 — 공용 DatePickerButton(옛 규약 그대로 `showPicker()` + 아이콘을 입력 전체로).
              라벨은 PeriodNav가 들고, 이 버튼은 **달력만** 연다. ECS 오늘 면과 같은 부품·같은 크기. */}
          <DatePickerButton value={date} max={todayYmd} onChange={onDateChange} title={t("os.date.pick")} />
        </div>

        <span className="bg-line hidden h-5 w-px shrink-0 sm:block" aria-hidden />

        {/* 반 필터 = '오늘 수업' 칩 하나로 통합(2026-07-27 원장: "수업명이 2줄로 겹치는데 굳이 2개나?").
            예전엔 ① 반 이름만 있는 필터 줄 + ② 시각·인원이 붙은 '오늘' 정보 줄이 따로 있었는데,
            서버가 `classTags = ["전체", ...todayClasses 이름]`으로 **같은 원본에서** 만들기 때문에 두 줄은
            항상 같은 목록이었다(roster.ts). → 정보가 많은 쪽(시각·인원)을 남기고 그걸 클릭 가능한 필터로.
            ⚠️ todayClasses 없이 classTags만 오는 호출부(데모 등)를 위해 남는 태그는 이름 칩으로 계속 렌더한다. */}
        <div className="flex flex-wrap items-center gap-1.5" data-help="os-class">
          <button
            type="button"
            onClick={() => onFilter(CLASS_TAG_ALL)}
            aria-pressed={classFilter === CLASS_TAG_ALL}
            className={`${TOOLBAR_CHIP} ${
              classFilter === CLASS_TAG_ALL ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF
            }`}
          >
            {t("os.class.all")}
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
                className="text-amber text-xs font-bold"
                title={t("os.class.delegatedTitle")}
              >
                {t("os.class.delegated")}
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
            판정은 학부모 문구 기준(write-filter.ts). `축: 값` 드롭다운(§10, 옛 세그먼트). 같은 값을 다시 고르면
            목록을 새로 계산한다(`reselect` — 필터를 켠 뒤 입력해도 카드·행이 사라지지 않게 고정된 목록을 정리). */}
        <span data-help="os-filters" className="inline-flex flex-wrap items-center gap-2">
        <HrefSelect
          axisLabel={t("os.write.axis")}
          ariaLabel={t("os.write.title")}
          value={writeFilter}
          onSelect={(v) => onWriteFilter(v as WriteFilter)}
          reselect
          // 수는 라벨에 싣는다(`미작성 5`) — hint는 트리거에 안 실려 고른 뒤엔 "몇 명 남았나"가 사라진다(옛 세그먼트는 상시 표시).
          options={writeOptions.map((o) => ({
            value: o.value,
            label: o.count != null ? `${o.label} ${o.count}` : o.label,
          }))}
        />
        </span>

        {/* 우측: 마감 통계 + 카드/표 토글 */}
        <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <div className="text-text-dim flex items-center gap-x-2.5 text-sm">
            <span>
              {t("os.stat.students")} <b className="text-foreground tabular">{stats.students}</b>
            </span>
            <span>
              {t("os.stat.progress")} <b className="text-primary tabular">{stats.progressDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span>
              {t("os.stat.test")} <b className="text-blue tabular">{stats.testDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span>
              {t("today.report.sent")} <b className="text-gold tabular">{stats.reportDone}</b>
              <span className="text-text-faint">/{stats.students}</span>
            </span>
            <span className="border-line rounded-full border px-1.5 py-0.5">
              {t("os.stat.done")} <b className="text-foreground tabular">{doneCount}</b>
              <span className="text-text-faint">/{total}</span>
            </span>
          </div>
          {makeupAdder}
          <span data-help="os-filters" className="inline-flex items-center gap-2">
          {/* AI 멘트 모드(내 계정) — 학원 기본 / 단일 A / 2문단 B. 강사별 저장(users.report_notice_mode).
              바꾸면 아래 보고서 입력이 1칸(A) ↔ 2칸(B, 수업 내용 / 태도·특이사항)으로 함께 바뀐다. `축: 값` 드롭다운(§10). */}
          <HrefSelect
            axisLabel={t("os.ment.axis")}
            ariaLabel={t("os.ment.title")}
            value={String(noticeMode)}
            onSelect={(v) => onNoticeMode(v === "null" ? null : (v as "A" | "B"))}
            options={noticeOptions.map((o) => ({
              value: String(o.value),
              label: o.label,
              hint: o.value === "A" ? t("os.ment.aHint") : o.value === "B" ? t("os.ment.bHint") : undefined,
            }))}
          />
          <span className="bg-line h-5 w-px" aria-hidden />
          {/* 글씨 크기(내 계정) — 원장 지시 2026-07-30. 지금 크기가 '작음'이라 기본은 화면 무변경.
              표뷰는 칸마다 px 글자가 박힌 조밀한 스프레드시트라 **표 전체를 같은 비율로** 확대한다
              (글자만 키우면 칸·체크박스와 어긋난다). 저장은 계정 = 다른 PC에서도 같은 크기. `축: 값` 드롭다운(§10). */}
          <HrefSelect
            axisLabel={t("os.fontSize")}
            ariaLabel={t("os.fontSize.title")}
            value={fontSize}
            onSelect={(v) => onFontSize(v as OnescreenFontSize)}
            options={ONESCREEN_FONT_SIZES.map((s) => ({ value: s, label: onescreenFontSizeLabel(s, lang) }))}
          />
          </span>
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
          <span data-help="os-quick">
          <Button
            render={<Link href="/attendance/quick" title={t("os.quick.title")} />}
            className="shrink-0"
          >
            {t("os.quick")}
          </Button>
          </span>
        )}
        {/* 카드 ↔ 표(스프레드시트) ↔ 오늘 발송 현황 ↔ 월간 발송(달력) ↔ 공지 = `보기: 카드` 드롭다운(§10, 옛 세그먼트 탭). */}
        <span data-help="os-filters">
        <HrefSelect
          axisLabel={t("os.face.axis")}
          ariaLabel={t("os.face.axis")}
          value={view}
          onSelect={(v) => onView(v as OneScreenView)}
          options={(readonlyView
            ? (["card", "grid", "status", "history"] as const)
            : (["card", "grid", "status", "history", "notice"] as const)
          )
            // ClassNote 기능이 꺼진 학원엔 발송 현황·월간 발송·공지 뷰가 없다(2026-09-30 "꺼지면 흔적 없이").
            .filter((v) => classnoteOn || !CLASSNOTE_ONLY_VIEWS.has(v))
            .map((v) => ({ value: v, label: t(VIEW_LABEL_KEY[v]) }))}
        />
        </span>
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
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
// 🔴 반 이름·강사 이름은 **여기서 영어로 바꾸지 않는다** — 원스크린은 학부모 보고서를 짓는
//    표면이라 teacher-view의 표기 헬퍼 import 자체가 구조 가드로 막혀 있다(class-name·
//    teacher-name 테스트). 우리가 쓴 UI 문구만 옮기고 사람·반 이름은 한국어 그대로다.
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
          ? tf("os.class.borrowed", {
              name: c.name,
              owner: c.ownerName
                ? tf("os.class.ownerNamed", { name: c.ownerName })
                : t("os.class.ownerUnknown"),
            })
          : c.delegatedAwayTo
            ? tf("os.class.lent", { name: c.name, to: c.delegatedAwayTo })
            : undefined
      }
      title={
        c.delegated
          ? tf("os.class.borrowedHint", {
              owner: c.ownerName
                ? tf("os.class.ownerNamed", { name: c.ownerName })
                : t("os.class.ownerUnknown"),
            })
          : c.delegatedAwayTo
            ? tf("os.class.lentHint", { to: c.delegatedAwayTo })
            : c.reportOptout
              ? reportOptoutNotice(lang)
              : undefined
      }
      className={`${base} ${tone}`}
    >
      <span className={`font-mono text-sm font-bold ${timeTone}`}>{c.startTime ?? "—"}</span>
      <span className={on ? "" : c.delegated ? "" : "text-foreground"}>{c.name}</span>
      {/* '수업보고서 미발송' 반 — 눌러서 보고서 칸이 잠긴 걸 보기 **전에** 알린다(2026-08-19). */}
      {c.reportOptout ? (
        <span className={on ? "text-primary-foreground/75" : "text-text-faint"} aria-hidden>
          {t("os.class.attendOnly")}
        </span>
      ) : null}
      {/* 내 반이 남에게 넘어간 날 — 반을 숨기지 않고 표식만 단다(권한은 그대로, 원 담임도 쓸 수 있다). */}
      {c.delegatedAwayTo ? (
        <span className={on ? "text-primary-foreground/75" : "text-amber"} aria-hidden>
          {t("os.class.lentChip")}
        </span>
      ) : null}
      <span className={countTone}>{c.studentCount}</span>
    </button>
  );
}
