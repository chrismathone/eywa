// 날짜·수업과 출결·보기는 바로 노출하고, 드문 설정은 팝오버로 접는다.
// 폰에서는 두 개의 가로 레일, 데스크톱에서는 한 줄로 배치한다.
import type { ReactNode } from "react";
import { EmbedLink } from "@/components/embed-link";
import { DatePickerButton } from "@/components/date-picker-button";
import { HrefSelect } from "@/components/href-select";
import { PeriodNav } from "@/components/period-nav";
import { Toolbar } from "@/components/toolbar";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
} from "@/components/toolbar-controls";
import { Button } from "@/components/ui/button";
import { addDays, DAY_LABEL_W } from "@/lib/date-kst";
import { type OnescreenFontSize } from "../font-size";
import { CLASS_TAG_ALL } from "../class-tags";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { CLASSNOTE_ONLY_VIEWS, type OneScreenView } from "../view";
import type { WriteFilter } from "../write-filter";
import type { TodayClass } from "../server/roster";
import { ClassChip } from "./top-bar-class-chip";
import { TopBarSettings } from "./top-bar-settings";

// 면 이름은 **사전 키**만 든다 — 문구는 사전 한 곳이라 화면 언어를 따라간다(v5 드롭다운 라벨도 이 표를 쓴다).
const VIEW_LABEL_KEY: Record<
  OneScreenView,
  | "os.face.card"
  | "os.face.table"
  | "os.face.sendStatus"
  | "os.face.monthly"
  | "os.face.notice"
> = {
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
  view,
  onView,
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
  view: OneScreenView;
  onView: (v: OneScreenView) => void;
  todayClasses: TodayClass[];
  noticeMode: "A" | "B" | null; // 강사 본인 멘트 모드(null=학원 기본)
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드
  onNoticeMode: (mode: "A" | "B" | null) => void;
  fontSize: OnescreenFontSize; // 글씨 크기(내 계정) — 아래 목록·표를 통째로 확대
  onFontSize: (size: OnescreenFontSize) => void;
  makeupAdder?: ReactNode; // 보강 학생 추가 컨트롤(슬롯)
  readonlyView?: boolean;
  classnoteOn?: boolean;
}) {
  const t = useSheetT();
  // 작성 상태 필터 — 순서는 원장 표현대로 전체 → 작성 → 미작성. 숫자는 **지금 조건에 맞는 학생 수**라
  // 고정(pinned)으로 화면에 남아 있는 학생과 다를 수 있다(그래서 아래 안내줄이 그 차이를 밝힌다).
  const writeOptions: { value: WriteFilter; label: string; count?: number }[] =
    [
      { value: "all", label: t("os.write.all") },
      {
        value: "written",
        label: t("os.write.written"),
        count: writeCounts.written,
      },
      {
        value: "unwritten",
        label: t("os.write.unwritten"),
        count: writeCounts.unwritten,
      },
    ];
  // 시각 칩으로 못 덮는 태그(todayClasses 없이 classTags만 오는 호출부 방어) — 보통은 빈 배열.
  const timedNames = new Set(todayClasses.map((c) => c.name));
  // ⚠️ 콜백 인자를 `t`로 두면 번역 함수를 가린다 — 이름을 갈라 둔다.
  const extraTags = classTags.filter(
    (tag) => tag !== CLASS_TAG_ALL && !timedNames.has(tag),
  );
  // 내 반 / 위임받은 반(0173a) 분리 — 각 그룹 안의 시각순 정렬은 서버가 이미 해놨다(roster.ts).
  const ownClasses = todayClasses.filter((c) => !c.delegated);
  const delegatedClasses = todayClasses.filter((c) => c.delegated);
  const isToday = date >= todayYmd; // 오늘(또는 이상) = 다음날 이동 막고 '오늘' 버튼 숨김
  return (
    <Toolbar rail={false} gap="gap-x-3 gap-y-2">
      <div className="toolbar-rail toolbar-rail-row items-center gap-x-2">
        <div className="flex shrink-0 items-center gap-1.5" data-help="os-date">
          <PeriodNav
            label={today}
            labelControl={<DatePickerButton label={today} value={date} max={todayYmd} onChange={onDateChange} title={t("os.date.pick")} ariaLabel={t("os.date.pick")} />}
            prevHref={addDays(date, -1)}
            nextHref={addDays(date, 1)}
            currentHref={todayYmd}
            relation={
              date === todayYmd
                ? "current"
                : date < todayYmd
                  ? "past"
                  : "future"
            }
            prevAriaLabel={t("os.date.prev")}
            nextAriaLabel={t("os.date.next")}
            currentTitle={t("nav.today")}
            nextDisabled={isToday}
            onNavigate={(ymd) => onDateChange(ymd)}
            labelWidth={DAY_LABEL_W}
          />
        </div>

        <span
          className="bg-line hidden h-5 w-px shrink-0 sm:block"
          aria-hidden
        />

        <div
          className="flex flex-wrap items-center gap-1.5"
          data-help="os-class"
        >
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
            <ClassChip
              key={c.id}
              c={c}
              on={c.name === classFilter}
              onFilter={onFilter}
            />
          ))}
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
            <ClassChip
              key={c.id}
              c={c}
              on={c.name === classFilter}
              onFilter={onFilter}
            />
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

        <span
          data-help="os-filters"
          className="inline-flex flex-wrap items-center gap-2"
        >
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
      </div>

      <div className="toolbar-rail toolbar-rail-row rail-row-first items-center gap-x-2">
        {readonlyView ? null : (
          <span data-help="os-quick">
            <Button
              variant="outline"
              render={
                <EmbedLink href="/attendance/quick" title={t("os.quick.title")} />
              }
              className="shrink-0"
            >
              {t("os.quick")}
            </Button>
          </span>
        )}
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
        <TopBarSettings
          noticeMode={noticeMode}
          academyNoticeMode={academyNoticeMode}
          onNoticeMode={onNoticeMode}
          fontSize={fontSize}
          onFontSize={onFontSize}
          classnoteOn={classnoteOn}
        />
        <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {makeupAdder}
        </div>
      </div>
    </Toolbar>
  );
}
