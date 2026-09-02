"use client";

// ECS 툴바 — 주 네비(flush 후 이동)·반 전환·요일 알약·패널 토글·저장 인디케이터·동시편집 배지.
// 주 네비 모양은 앱 전역 단일 소스 PeriodNav(원장 2026-09-01 "주차이동을 월간처럼 깔끔한 스타일로").
// WeekNav(ParamLink)가 아니라 PeriodNav를 **직접** 쓰는 이유는 그대로다: 이동 전 store.flush()를
// await해야 해서(§F) `onNavigate`로 가로챈다 — PeriodNav가 그 동안 "가는 중"을 그린다.
//
// 🔴 상단 바의 **껍데기·왼쪽 덩어리·보기 전환은 월간 뷰와 같은 것**을 쓴다([chrome.ts](../chrome.ts) +
//    [sheet-chrome](./sheet-chrome.tsx), 원장 2026-09-01 "월간과 주간 차이가 너무 심함 · 일관성있게
//    디자인 통일"). 여기에 알약·셀렉트 표기를 다시 적지 말 것 — 그게 두 화면이 갈렸던 이유다.
import { ClipboardCheck } from "@/components/icons/eywa-icon-compat";
import { addWeeks, thisMonday, WEEK_LABEL_W } from "@/features/timetable/lib/week";
import { PeriodNav } from "@/components/period-nav";

import { EditingBadge } from "@/features/presence/editing-badge";
import { ecsPresenceScope } from "../lib/presence-scope";
import { SHEET_BAR, SHEET_SEG_BOX, sheetFacesFor, sheetPill, sheetSegItem } from "../chrome";
import { monthOfWeek } from "../face-nav";
import { setMyEcsMonthView } from "../server/actions";
import { SheetBarDivider, SheetClassPicker, SheetFaceSwitch } from "./sheet-chrome";
import type { ClassSheetWeekData } from "../server/queries";
import { ECS_FONT_SIZES, ECS_FONT_SIZE_LABEL, type EcsFontSize } from "../font-size";
import { attHref } from "@/app/(shell)/attendance/_components/att-href";
import { useSaveIndicator, type SheetSaveStore } from "./use-sheet-saves";
import { EcsMakeupAdder } from "./ecs-makeup-adder";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
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
        hrefForClass={(id) => hrefFor(id, data.weekMonday)}
      />
      {/* 임시 위임(0173a) — 지금 **남의 반 시트**를 고치는 중이라는 사실이 열고 나서도 보여야 한다.
          창(embed)에선 상단 PageHeader가 통째로 숨겨지므로 배지 자리는 여기가 유일하다. */}
      {data.delegated ? (
        <span
          className="border-amber bg-amber-soft text-amber shrink-0 rounded-pill border px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
          title={`${data.classTeacherName ? `${data.classTeacherName} 선생님 반` : "다른 선생님 반"} — 이 기간에만 대신 맡은 위임 반입니다`}
        >
          위임{data.classTeacherName ? ` · ${data.classTeacherName} 선생님 반` : ""}
        </span>
      ) : null}
      <SheetBarDivider />

      {/* 🔴 '이번주' 알약이 하던 두 일은 PeriodNav가 나눠 맡는다 — 이번 주로 돌아가기는 **가운데 라벨
          클릭**, "지금 이번 주인가"는 **과거/미래 조회 배지**. 배지를 지우면 지난 주를 보면서 이번 주로
          착각한다(그 알약이 색으로 말하던 사실이다). */}
      <PeriodNav
        label={data.weekLabel}
        prevHref={hrefFor(data.classId, addWeeks(data.weekMonday, -1))}
        nextHref={hrefFor(data.classId, addWeeks(data.weekMonday, 1))}
        currentHref={hrefFor(data.classId, thisMonday(data.today))}
        relation={rel}
        prevAriaLabel="이전 주"
        nextAriaLabel="다음 주"
        currentTitle="눌러서 이번 주로"
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

      <span className="text-foreground text-[11px] font-bold">요일</span>
      <div className="flex items-center gap-1">
        <button type="button" className={pill(dayFilter === null)} onClick={() => onDayFilter(null)}>
          전체
        </button>
        {data.grid.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={pill(dayFilter === d.date)}
            // 휴일이면 요일 글자만 빨갛게(달력 관행) — 칩을 지우거나 막지 않는다. 이름은 title로.
            // ⚠️ 눌린 칩은 배경이 네이비라 빨강을 얹으면 안 읽힌다 → 안 눌렸을 때만.
            title={d.holiday ? `${d.date.slice(5)} ${d.holiday}` : undefined}
            onClick={() => onDayFilter(dayFilter === d.date ? null : d.date)}
          >
            <span className={d.holiday && dayFilter !== d.date ? "text-danger" : undefined}>{DOW_KO[d.dow]}</span>
            {d.date === data.today ? <span className="ml-0.5 align-middle text-[8px]">●</span> : null}
          </button>
        ))}
      </div>

      <span className="ml-auto flex items-center gap-2">
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
          title={`${data.className} 반 ${attendanceDate.slice(0, 7)} 출석부 열기`}
        >
          <ClipboardCheck className="size-3" /> 출석부
        </button>
        {/* JJ 표시(내 계정) — 원장 2026-08-03: 코드가 정하지 말고 여기서 고른다.
            ⚠️ 2026-08-06부터 **LAB은 여기서 빠졌다**(항상 제외 — 전용 출석부로 이관 예정). 라벨이 'LAB·JJ'
               면 켜도 LAB이 안 나오는 거짓 스위치가 된다.
            ⚠️ 글씨 크기와 달리 **서버가 다시 그린다** — 이 값이 카드뿐 아니라 작성률 분모까지 정하기
               때문(보이는 교시 = 세는 교시). 그래서 왕복 중엔 잠근다. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-foreground shrink-0 text-[11px] font-bold">JJ</span>
          <span
            className={SHEET_SEG_BOX}
            title="JJ(집중자율수업실) 교시를 시트에 그릴지 — 숨기면 카드와 작성률에서 함께 빠집니다(쓴 기록은 지워지지 않습니다). LAB은 전용 출석부로 옮길 예정이라 항상 빠집니다."
          >
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                disabled={selfStudyPending}
                onClick={() => onShowSelfStudy(v)}
                aria-pressed={showSelfStudy === v}
                className={`${sheetSegItem(showSelfStudy === v)} disabled:cursor-wait disabled:opacity-60`}
              >
                {v ? "표시" : "숨김"}
              </button>
            ))}
          </span>
        </span>
        {/* 글씨 크기(내 계정) — 수업보고서 강사뷰와 같은 컨트롤·같은 어휘(원장 지시 2026-07-31).
            지금 크기가 '작음'이라 기본은 화면 무변경. 저장은 계정이라 다른 PC에서도 같은 크기. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-foreground shrink-0 text-[11px] font-bold">글씨</span>
          <span
            className={SHEET_SEG_BOX}
            title="계획 패널·주간 시트의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다"
          >
            {ECS_FONT_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onFontSize(s)}
                aria-pressed={fontSize === s}
                className={sheetSegItem(fontSize === s)}
              >
                {ECS_FONT_SIZE_LABEL[s]}
              </button>
            ))}
          </span>
        </span>
        <EditingBadge scope={ecsPresenceScope(data.classId, data.weekMonday)} />
        {conflicts > 0 ? (
          <span className="text-danger text-[12px] font-bold whitespace-nowrap">충돌 {conflicts}건 — 셀에서 선택</span>
        ) : pending > 0 ? (
          <span className="text-text-dim text-[12px] font-semibold whitespace-nowrap">저장 중…</span>
        ) : (
          <span className="text-text-dim text-[12px] font-semibold whitespace-nowrap">저장됨</span>
        )}
        <button type="button" className={pill(panelOpen)} onClick={onTogglePanel}>
          계획 패널
        </button>
      </span>
    </div>
  );
}
