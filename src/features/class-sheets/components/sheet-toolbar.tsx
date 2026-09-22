"use client";

// ECS 툴바 — 주 네비(flush 후 이동)·반 전환·요일 드롭다운·패널 토글·저장 인디케이터·동시편집 배지.
// 주 네비 모양은 앱 전역 단일 소스 PeriodNav(원장 2026-09-01 "주차이동을 월간처럼 깔끔한 스타일로").
// WeekNav(ParamLink)가 아니라 PeriodNav를 **직접** 쓰는 이유는 그대로다: 이동 전 store.flush()를
// await해야 해서(§F) `onNavigate`로 가로챈다 — PeriodNav가 그 동안 "가는 중"을 그린다.
//
// 🔴 상단 바의 **껍데기·왼쪽 덩어리·보기 전환은 월간 뷰와 같은 것**을 쓴다([chrome.ts](../chrome.ts) +
//    [sheet-chrome](./sheet-chrome.tsx), 원장 2026-09-01 "월간과 주간 차이가 너무 심함 · 일관성있게
//    디자인 통일"). 여기에 알약·셀렉트 표기를 다시 적지 말 것 — 그게 두 화면이 갈렸던 이유다.
import { ClipboardCheck } from "@/components/icons/aywa-icon-compat";
import { addWeeks, thisMonday, WEEK_LABEL_W } from "@/features/timetable/lib/week";
import { HrefSelect } from "@/components/href-select";
import { PeriodNav } from "@/components/period-nav";

import { EditingBadge } from "@/features/presence/editing-badge";
import { ecsPresenceScope } from "../lib/presence-scope";
import { SHEET_BAR, SHEET_SEG_BOX, sheetFacesFor, sheetPill, sheetSegItem } from "../chrome";
import { monthOfWeek } from "../face-nav";
import { setMyEcsMonthView } from "../server/actions";
import { SheetBarDivider, SheetClassPicker, SheetFaceSwitch } from "./sheet-chrome";
import type { ClassSheetWeekData } from "../server/queries";
import { ECS_FONT_SIZES, FONT_SIZE_KEY, type EcsFontSize } from "../font-size";
import { sheetDowLabel, sheetWeekLabel } from "@/features/teacher-view/i18n";
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { attHref } from "@/app/(shell)/attendance/_components/att-href";
import { useSaveIndicator, type SheetSaveStore } from "./use-sheet-saves";
import { EcsMakeupAdder } from "./ecs-makeup-adder";

// 요일 글자·글씨 크기 라벨은 [i18n.ts](../i18n.ts) 한 곳 — 화면 언어(한/영)를 따라간다(2026-09-03).
// 알약 표기는 [chrome.ts](../chrome.ts) 한 곳 — 월간 뷰의 표시 토글도 같은 것을 쓴다.
const pill = sheetPill;

export function SheetToolbar({
  data,
  classOptions,
  store,
  dayFilter,
  onDayFilter,
  panelOpen,
  onTogglePanel,
  onNavigate,
  fontSize,
  onFontSize,
  showSelfStudy,
  onShowSelfStudy,
  selfStudyPending,
}: {
  data: ClassSheetWeekData;
  classOptions: { id: string; name: string }[];
  store: SheetSaveStore;
  dayFilter: string | null;
  onDayFilter: (day: string | null) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** 이동 전 저장 flush를 기다린다 — Promise를 돌려주면 네비가 그 동안 "가는 중"을 그린다. */
  onNavigate: (href: string) => void | Promise<void>;
  /** 글씨 크기(내 계정) — 아래 계획 패널·주간 그리드를 통째로 확대. 상단 바는 그대로. */
  fontSize: EcsFontSize;
  onFontSize: (size: EcsFontSize) => void;
  /**
   * **JJ** 교시 표시(내 계정). 끄면 카드도 작성률도 빠진다 — 서버가 다시 그린다.
   * ⚠️ LAB은 여기 없다(항상 제외, 원장 2026-08-06 "전용 출석부를 만들 예정") — 스위치를 되살리지 말 것.
   */
  showSelfStudy: boolean;
  onShowSelfStudy: (show: boolean) => void;
  /** 표시 토글 저장·재조회 중 — 두 번 눌러 왕복이 겹치지 않게 잠근다. */
  selfStudyPending: boolean;
}) {
  const { pending, conflicts } = useSaveIndicator(store);
  // 화면 언어(내 계정) — 문구만 바뀌고 저장되는 데이터·작성률은 한 글자도 안 바뀐다.
  const t = useSheetT();
  const lang = useSheetLang();
  const hrefFor = (classId: string, monday: string) => `/ecs/${classId}?week=${monday}`;
  // 출석부 바로가기 — 지금 보고 있는 날(요일 필터) 기준으로 그 반의 그 달 출석부를 연다.
  // 🔴 링크는 출석부의 **단일 빌더**(attHref)로 만든다 — 여기서 파라미터를 따로 조립하면 규약이 갈라져
  //    (mode 누락 등) 강사 기본값인 '강사 전체'로 되돌아간다(att-href.ts의 🔴 주석).
  const attendanceDate = dayFilter ?? data.weekMonday;
  const attendanceHref = attHref({ classId: data.classId, month: attendanceDate.slice(0, 7), mode: "class" });
  const rel = data.weekRelation;

  return (
    <div className={SHEET_BAR}>
      {/* 목록 · 반 선택(노란 표기) · 반 정보 보기 — 월간 뷰와 **같은 조각**(sheet-chrome.tsx). */}
      <SheetClassPicker
        classId={data.classId}
        classLabel={data.className}
        classOptions={classOptions}
        // 담임 이름을 반 표기 안 오른쪽에(원장 2026-09-02 *"ecs도 마찬가지"*) — MCS와 같은 조각·같은 자리.
        teacherName={data.classTeacherName}
        onNavigate={onNavigate}
        // 🔴 **온 곳으로 돌려보낸다**(원장 2026-09-05 *"좌측 목록 눌렀을때 주간 시트 상태로 돌아가도록"*).
        //    맨 `/ecs`로 보내면 강사는 기본 착지인 **'오늘'** 면으로 떨어져, 방금 훑던 주간 목록이 사라진다
        //    (랜딩 기본값은 강사=오늘·사무실=주간이라 사람마다 다른 곳에 도착한다). 보던 주까지 함께 싣는다.
        listHref={`/ecs?view=week&week=${data.weekMonday}`}
        hrefForClass={(id) => hrefFor(id, data.weekMonday)}
      />
      {/* 임시 위임(0173a) — 지금 **남의 반 시트**를 고치는 중이라는 사실이 열고 나서도 보여야 한다.
          창(embed)에선 상단 PageHeader가 통째로 숨겨지므로 배지 자리는 여기가 유일하다. */}
      {data.delegated ? (
        <span
          className="border-amber bg-amber-soft text-amber shrink-0 rounded-pill border px-2 py-0.5 text-xs font-bold whitespace-nowrap"
          title={`${
            data.classTeacherName
              ? `${data.classTeacherName}${t("toolbar.delegated.own")}`
              : t("toolbar.delegated.other")
          } — ${t("toolbar.delegated.title")}`}
        >
          {t("toolbar.delegated")}
          {data.classTeacherName ? ` · ${data.classTeacherName}${t("toolbar.delegated.own")}` : ""}
        </span>
      ) : null}
      <SheetBarDivider />

      {/* 🔴 '이번주' 알약이 하던 두 일은 PeriodNav가 나눠 맡는다 — 이번 주로 돌아가기는 **가운데 라벨
          클릭**, "지금 이번 주인가"는 **과거/미래 조회 배지**. 배지를 지우면 지난 주를 보면서 이번 주로
          착각한다(그 알약이 색으로 말하던 사실이다). */}
      <PeriodNav
        label={sheetWeekLabel(data.weekMonday, data.weekLabel, lang)}
        prevHref={hrefFor(data.classId, addWeeks(data.weekMonday, -1))}
        nextHref={hrefFor(data.classId, addWeeks(data.weekMonday, 1))}
        currentHref={hrefFor(data.classId, thisMonday(data.today))}
        relation={rel}
        prevAriaLabel={t("toolbar.prevWeek")}
        nextAriaLabel={t("toolbar.nextWeek")}
        currentTitle={t("toolbar.thisWeek")}
        labelWidth={WEEK_LABEL_W}
        onNavigate={onNavigate}
      />
      {/* 주간 | 달력 | 진도표 (+ EiE면 계획(MP)) — 월간 뷰와 **같은 칸**(원장 2026-09-01). 전엔 여기가
          `[월간]` 버튼 하나뿐이라 진도표로 가려면 월간을 거쳐 한 번 더 눌러야 했다.
          🔴 계획(MP)은 EiE 반에만 선다 — 판정은 서버가 준 `isEie`(english_track 컬럼) 하나다.
          이동 전 flush는 onNavigate가 한다. */}
      <SheetFaceSwitch
        current="week"
        faces={sheetFacesFor(data.isEie)}
        onSelect={(face) => {
          if (face === "week") return;
          // 🔴 보기 선택은 **계정에도 남긴다** — 안 남기면 라벨·모양이 같은 두 버튼(주간 바의 '달력'과
          //    월간 바의 '달력')이 한쪽만 기억하는, 눌러 보기 전엔 모르는 차이가 생긴다.
          //    이번 방문은 아래 `view=`가 확정하므로 이 저장은 왕복을 기다리지 않아도 된다.
          void setMyEcsMonthView(face);
          // 🔴 여는 달 = **지금 보고 있는 주가 속한 달**([monthOfWeek](../face-nav.ts) — 월요일의 달이
          //    아니다). `week=`는 "왔던 주"라 월간에서 '주간'을 누르면 이 주로 정확히 돌아온다.
          onNavigate(
            `/ecs/${data.classId}/month?month=${monthOfWeek(data.weekMonday)}&week=${data.weekMonday}&view=${face}`,
          );
        }}
      />
      <SheetBarDivider />

        {/* 요일 = `요일: 전체` 드롭다운(§10, 옛 알약 칩 줄). 휴일은 항목 hint에 이름으로, 오늘은 '오늘'로 — 색 대신 글자.
            옛 칩은 눌린 요일을 다시 누르면 해제였는데 이제는 '전체'를 고른다(같은 값 재선택은 무시 — reselect 아님).
            🔴 요일 글자는 화면 언어를 따른다(`sheetDowLabel`) — 사전이 아니라 그 함수가 단일 소스다. */}
        <HrefSelect
          axisLabel={t("toolbar.dow")}
          ariaLabel={t("toolbar.dow.aria")}
          value={dayFilter ?? "all"}
          onSelect={(v) => onDayFilter(v === "all" ? null : v)}
          options={[
            { value: "all", label: t("toolbar.all") },
            ...data.grid.days.map((d) => ({
              value: d.date,
              label: `${sheetDowLabel(d.dow, lang)} ${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`,
              // 휴일과 오늘이 겹치면 둘 다(`추석 · 오늘`) — 휴일이 '오늘'을 덮으면 오늘 표식이 사라진다.
              hint: [d.holiday, d.date === data.today ? t("toolbar.today") : null].filter(Boolean).join(" · ") || undefined,
            })),
          ]}
        />

      {/* 폰(`phone:` = 최상위 프레임 <768px, 창 제외)에선 이 묶음도 감긴다 — 출석부·JJ·글씨·저장됨·계획 패널이 한 줄 470px이라
          366px 본문을 가로로 밀었다(2026-09-13 모바일 전수검사). 데스크톱·창은 종전대로 한 줄. */}
      <span className="ml-auto flex items-center gap-2 phone:flex-wrap">
        {dayFilter ? (
          <EcsMakeupAdder
            classId={data.classId}
            date={dayFilter}
            existingIds={new Set(
              (data.grid.days.find((d) => d.date === dayFilter)?.slots ?? []).flatMap((s) =>
                s.roster.map((r) => r.studentId),
              ),
            )}
            canAdd={data.canMarkAttendanceByDate[dayFilter] ?? false}
            slots={(data.grid.days.find((d) => d.date === dayFilter)?.slots ?? []).map((s) => ({
              ...s,
              periodLabel: data.periodLabelBySlot[`${dayFilter}|${s.slotStart}`] ?? null,
            }))}
          />
        ) : null}
        <button
          type="button"
          className={`${pill(false)} inline-flex items-center gap-1`}
          onClick={() => onNavigate(attendanceHref)}
          title={`${data.className} · ${attendanceDate.slice(0, 7)} — ${t("toolbar.attendance.title")}`}
        >
          <ClipboardCheck className="size-3" /> {t("toolbar.attendance")}
        </button>
        {/* JJ 표시(내 계정) — 원장 2026-08-03: 코드가 정하지 말고 여기서 고른다.
            ⚠️ 2026-08-06부터 **LAB은 여기서 빠졌다**(항상 제외 — 전용 출석부로 이관 예정). 라벨이 'LAB·JJ'
               면 켜도 LAB이 안 나오는 거짓 스위치가 된다.
            ⚠️ 글씨 크기와 달리 **서버가 다시 그린다** — 이 값이 카드뿐 아니라 작성률 분모까지 정하기
               때문(보이는 교시 = 세는 교시). 그래서 왕복 중엔 잠근다. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-foreground shrink-0 text-xs font-bold">{t("toolbar.jj")}</span>
          <span className={SHEET_SEG_BOX} title={t("toolbar.jj.title")}>
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                disabled={selfStudyPending}
                onClick={() => onShowSelfStudy(v)}
                aria-pressed={showSelfStudy === v}
                className={`${sheetSegItem(showSelfStudy === v)} disabled:cursor-wait disabled:opacity-60`}
              >
                {v ? t("toolbar.show") : t("toolbar.hide")}
              </button>
            ))}
          </span>
        </span>
          {/* 글씨 크기(내 계정) — 수업보고서 강사뷰와 같은 컨트롤·같은 어휘(원장 지시 2026-07-31). `축: 값` 드롭다운(§10). */}
          <HrefSelect
            axisLabel={t("toolbar.font")}
            ariaLabel={t("toolbar.font.title")}
            value={fontSize}
            onSelect={(v) => onFontSize(v as EcsFontSize)}
            options={ECS_FONT_SIZES.map((s) => ({ value: s, label: t(FONT_SIZE_KEY[s]) }))}
          />
          <EditingBadge scope={ecsPresenceScope(data.classId, data.weekMonday)} />
          {conflicts > 0 ? (
            <span className="text-danger text-sm font-bold whitespace-nowrap">
              {t("toolbar.conflict")} {conflicts}
              {t("toolbar.conflict.hint")}
            </span>
          ) : pending > 0 ? (
            <span className="text-text-dim text-sm font-semibold whitespace-nowrap">{t("toolbar.saving")}</span>
          ) : (
            <span className="text-text-dim text-sm font-semibold whitespace-nowrap">{t("toolbar.saved")}</span>
        )}
        <button type="button" className={pill(panelOpen)} onClick={onTogglePanel}>
          {t("toolbar.planPanel")}
        </button>
      </span>
    </div>
  );
}
