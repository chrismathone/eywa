import { useRef, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { addDays } from "@/lib/date-kst";
import {
  ONESCREEN_FONT_SIZES,
  ONESCREEN_FONT_SIZE_LABEL,
  type OnescreenFontSize,
} from "../font-size";
import type { OneScreenView } from "../view";
import type { WriteFilter } from "../write-filter";
import type { TodayClass } from "../server/roster";

/**
 * 원스크린 상단 바 — 날짜 + 반 필터 + 오늘 수업 + 마감 통계 + 카드/표 토글을 **한 줄(반응형)**로.
 * 예전 TopBar+HubBar 2개 카드를 하나의 flex-wrap 바로 합침 — 넓은 화면은 1줄, 좁으면 자연 wrap(불필요한 2줄 제거).
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
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-3 py-2">
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
            className="text-text-dim hover:bg-bg-soft rounded-sm px-1 py-1"
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
            className="text-text-dim hover:bg-bg-soft rounded-sm px-1 py-1 disabled:opacity-30"
          >
            <EyIcon name="chevronRight" size={16} />
          </button>
          {!isToday ? (
            <button
              type="button"
              onClick={() => onDateChange(todayYmd)}
              className="border-line text-primary hover:bg-bg-soft ml-1 rounded-lg border px-1.5 py-0.5 text-[11px] font-bold"
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
          className={`rounded-pill px-2.5 py-1 text-[12px] font-bold transition ${
            classFilter === "전체"
              ? "bg-primary text-primary-foreground"
              : "border-line text-text-dim hover:bg-bg-soft border"
          }`}
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
              className={`rounded-pill px-2.5 py-1 text-[12px] font-bold transition ${
                on ? "bg-primary text-primary-foreground" : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {/* 작성 상태 필터 — "아직 안 쓴 학생만" 추려 마저 쓰기 위한 것(반 필터 바로 옆 = 둘 다 '무엇을 보여줄지').
          판정은 학부모 문구 기준(write-filter.ts). 같은 값을 다시 누르면 목록을 새로 계산한다. */}
      <div
        className="border-line flex items-center rounded-full border p-0.5"
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
              className={`rounded-full px-2 py-1 text-[11px] font-bold transition ${
                on ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
              }`}
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
          className="border-line flex items-center rounded-full border p-0.5"
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
                className={`rounded-full px-1.5 py-1 text-[11px] font-bold transition ${
                  on ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
                }`}
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
        <div
          className="border-line flex items-center rounded-full border p-0.5"
          title="아래 목록·표의 글씨 크기(내 계정) — 다른 PC에서도 같은 크기로 열립니다"
        >
          <span className="text-text-faint px-1.5 text-[11px] font-bold">글씨 크기</span>
          {ONESCREEN_FONT_SIZES.map((s) => {
            const on = fontSize === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => onFontSize(s)}
                aria-pressed={on}
                className={`rounded-full px-1.5 py-1 text-[11px] font-bold transition ${
                  on ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
                }`}
              >
                {ONESCREEN_FONT_SIZE_LABEL[s]}
              </button>
            );
          })}
        </div>
        {/* 카드 ↔ 표(스프레드시트) ↔ 오늘 발송 현황 ↔ 월간 발송(달력) ↔ 공지 뷰 전환 */}
        <div className="border-line flex items-center rounded-full border p-0.5">
          {(["card", "grid", "status", "history", "notice"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              aria-pressed={view === v}
              className={`rounded-full px-2 py-1 text-[11px] font-bold transition ${
                view === v ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
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
    </div>
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
  const base = "rounded-pill inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-bold whitespace-nowrap transition";
  const tone = c.delegated
    ? on
      ? "bg-amber text-white"
      : "border-amber bg-amber-soft text-amber hover:bg-amber/15 border"
    : on
      ? "bg-primary text-primary-foreground"
      : "border-line text-text-dim hover:bg-bg-soft border";
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
            : undefined
      }
      className={`${base} ${tone}`}
    >
      <span className={`font-mono text-[10px] font-bold ${timeTone}`}>{c.startTime ?? "—"}</span>
      <span className={on ? "" : c.delegated ? "" : "text-foreground"}>{c.name}</span>
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
