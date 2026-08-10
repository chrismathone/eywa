"use client";

// ECS 툴바 — 주 네비(flush 후 이동)·반 전환·요일 알약·패널 토글·저장 인디케이터·동시편집 배지.
// WeekNav(ParamLink)를 안 쓰는 이유: 이동 전 store.flush()를 await해야 해서(§F) 버튼+onNavigate로 처리.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";
import { addWeeks, thisMonday } from "@/features/timetable/lib/week";
import { EditingBadge } from "@/features/presence/editing-badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import type { ClassSheetWeekData } from "../server/queries";
import { ECS_FONT_SIZES, ECS_FONT_SIZE_LABEL, type EcsFontSize } from "../font-size";
import { useSaveIndicator, type SheetSaveStore } from "./use-sheet-saves";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
// ⚠️ cursor-pointer 명시 — Tailwind v4 preflight엔 v3의 `button{cursor:pointer}`가 없어서
// 안 적으면 클릭 가능한 버튼이 화살표로 보인다(이 앱 globals.css에도 cursor 규칙 0건).
// 테두리는 line-strong — 헤어라인(9%)이면 눌 수 있는 알약인지 글자인지 구분이 안 된다(가독성 07-31).
// ⚠️ 테두리는 잉크 고정(원장 2026-08-10 "모든 박스에 진한 검은색 테두리") — line-strong(18%)조차 흰 카드
// 위에선 "눌 수 있는 알약인지 글자인지" 구분이 안 됐다(07-31 가독성 지적의 연장). 글자도 dim→foreground 굵게.
const iconBtn =
  "border-foreground text-foreground hover:bg-bg-soft inline-flex shrink-0 cursor-pointer items-center rounded-full border p-1 transition";
const pill = (on: boolean) =>
  `shrink-0 cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] font-bold transition ${
    on
      ? "border-foreground bg-foreground text-background"
      : "border-foreground text-foreground hover:bg-bg-soft"
  }`;

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
  trailing,
}: {
  data: ClassSheetWeekData;
  classOptions: { id: string; name: string }[];
  store: SheetSaveStore;
  dayFilter: string | null;
  onDayFilter: (day: string | null) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onNavigate: (href: string) => void;
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
  /**
   * 우측 끝 추가 컨트롤(현재 = '시트 가져오기'). **노드로 받는 이유**: 그 버튼은 저장 큐 flush와
   * classId를 함께 써야 해서 콜백 2~3개를 props로 더 받아야 한다 — 이미 props가 많은 툴바를 더
   * 부풀리지 않으려고 소유자(SheetClient)가 만들어 꽂는다(수업보고서 카드 `todayInputs` 선례).
   */
  trailing?: ReactNode;
}) {
  const { pending, conflicts } = useSaveIndicator(store);
  const hrefFor = (classId: string, monday: string) => `/ecs/${classId}?week=${monday}`;
  const rel = data.weekRelation;

  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-2.5">
      <button type="button" className={pill(false)} onClick={() => onNavigate("/ecs")}>
        목록
      </button>
      <span className="w-[220px] shrink-0">
        <SearchableSelect
          options={classOptions.map((c) => ({ value: c.id, label: c.name }))}
          value={data.classId}
          onValueChange={(v) => {
            if (v && v !== data.classId) onNavigate(hrefFor(v, data.weekMonday));
          }}
          placeholder="반 선택"
          ariaLabel="반 전환"
          // 기본 트리거(px-3·py-2·text-sm ≈ 38px)는 툴바에서 혼자 거대해 줄 높이를 혼자 정했다
          // (원장 2026-08-10 "드랍박스가 너무 거대해서 컴팩트해지지 못하는 부분"). 알약과 같은 높이·같은
          // 잉크 테두리로 낮추고, **수업명은 굵게**(원장 "수업명 … 진하게").
          compact
          triggerClassName="border-foreground text-foreground focus:border-primary h-7 rounded-full border px-2.5 text-[13px] font-bold outline-none"
          // 반이 수십 개라 목록에서 **지금 보고 있는 반**을 눈으로 못 찾겠다는 지적(원장 2026-08-06).
          // 체크 아이콘만으론 약해서 노란 배경 + 굵은 글씨로 또렷하게.
          highlightSelected
        />
      </span>
      {/* 반 정보 보기(원장 2026-08-06) — 시트에서 보던 반의 상세로 바로 간다. 드롭다운 **바로 옆**이라
          "지금 고른 그 반"이라는 게 자리로 읽힌다. WindowLink라 창 안에선 드릴인, 최상위에선 새 창. */}
      <WindowLink
        href={`/classes/${data.classId}`}
        title={data.className}
        className={`${pill(false)} inline-flex items-center`}
        ariaLabel={`${data.className} 반 정보 보기`}
      >
        반 정보 보기
      </WindowLink>
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
      <span className="bg-line h-4 w-px" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className={iconBtn}
          aria-label="이전 주"
          onClick={() => onNavigate(hrefFor(data.classId, addWeeks(data.weekMonday, -1)))}
        >
          <ChevronLeft size={13} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={pill(rel === "current")}
          onClick={() => onNavigate(hrefFor(data.classId, thisMonday(data.today)))}
        >
          이번주
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="다음 주"
          onClick={() => onNavigate(hrefFor(data.classId, addWeeks(data.weekMonday, 1)))}
        >
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
      <span className="text-foreground text-[13px] font-bold whitespace-nowrap">{data.weekLabel}</span>
      {rel !== "current" ? (
        <span className="border-foreground text-foreground rounded-full border px-2 py-0.5 text-[12px] font-bold whitespace-nowrap">
          {rel === "past" ? "지난 주 조회" : "다음 주 조회"}
        </span>
      ) : null}
      <span className="bg-line h-4 w-px" aria-hidden />

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
            onClick={() => onDayFilter(dayFilter === d.date ? null : d.date)}
          >
            {DOW_KO[d.dow]}
            {d.date === data.today ? <span className="ml-0.5 align-middle text-[8px]">●</span> : null}
          </button>
        ))}
      </div>

      <span className="ml-auto flex items-center gap-2">
        {trailing}
        {/* JJ 표시(내 계정) — 원장 2026-08-03: 코드가 정하지 말고 여기서 고른다.
            ⚠️ 2026-08-06부터 **LAB은 여기서 빠졌다**(항상 제외 — 전용 출석부로 이관 예정). 라벨이 'LAB·JJ'
               면 켜도 LAB이 안 나오는 거짓 스위치가 된다.
            ⚠️ 글씨 크기와 달리 **서버가 다시 그린다** — 이 값이 카드뿐 아니라 작성률 분모까지 정하기
               때문(보이는 교시 = 세는 교시). 그래서 왕복 중엔 잠근다. */}
        <span
          className="border-foreground flex items-center rounded-full border p-0.5"
          title="JJ(집중자율수업실) 교시를 시트에 그릴지 — 숨기면 카드와 작성률에서 함께 빠집니다(쓴 기록은 지워지지 않습니다). LAB은 전용 출석부로 옮길 예정이라 항상 빠집니다."
        >
          <span className="text-foreground px-1.5 text-[11px] font-bold">JJ</span>
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              disabled={selfStudyPending}
              onClick={() => onShowSelfStudy(v)}
              aria-pressed={showSelfStudy === v}
              className={`cursor-pointer rounded-full px-1.5 py-0.5 text-[11px] font-bold transition disabled:cursor-wait disabled:opacity-60 ${
                showSelfStudy === v ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-bg-soft"
              }`}
            >
              {v ? "표시" : "숨김"}
            </button>
          ))}
        </span>
        {/* 글씨 크기(내 계정) — 수업보고서 강사뷰와 같은 컨트롤·같은 어휘(원장 지시 2026-07-31).
            지금 크기가 '작음'이라 기본은 화면 무변경. 저장은 계정이라 다른 PC에서도 같은 크기. */}
        <span
          className="border-foreground flex items-center rounded-full border p-0.5"
          title="계획 패널·주간 시트의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다"
        >
          <span className="text-foreground px-1.5 text-[11px] font-bold">글씨</span>
          {ECS_FONT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onFontSize(s)}
              aria-pressed={fontSize === s}
              className={`cursor-pointer rounded-full px-1.5 py-0.5 text-[11px] font-bold transition ${
                fontSize === s ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-bg-soft"
              }`}
            >
              {ECS_FONT_SIZE_LABEL[s]}
            </button>
          ))}
        </span>
        <EditingBadge scope={`ecs:${data.classId}:${data.weekMonday}`} />
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
