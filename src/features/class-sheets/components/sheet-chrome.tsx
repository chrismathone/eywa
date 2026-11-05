"use client";

import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import { MARKER_TRIGGER, MARKER_WIDTH } from "@/components/ui/marker-trigger";
import {
  SHEET_FACES,
  SHEET_PILL_GLYPH_ICON,
  SHEET_PILL_GLYPH_LABEL,
  SHEET_SEG_BOX,
  sheetFaceLabel,
  sheetFaceTitle,
  sheetPill,
  sheetSegItem,
  type SheetFace,
} from "../chrome";
import { useSheetT, useSheetLang } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { useTeacherNames } from "@/features/teacher-view/teacher-names-context";

/**
 * ECS 상단 바의 **공용 조각** — 표기는 [`chrome.ts`](../chrome.ts), 여기는 그리는 쪽.
 * 주간 시트([sheet-toolbar](./sheet-toolbar.tsx))와 월간 뷰([month-client](./month-client.tsx))가
 * 이 둘을 그대로 쓴다(원장 2026-09-01 *"일관성있게 디자인 통일"*).
 */

/** 덩어리 사이 세로 실선 — 두 화면이 같은 자리에서 끊어 읽히게. */
export function SheetBarDivider() {
  return <span className="bg-line h-4 w-px" aria-hidden />;
}

/**
 * 알약 **속살** — 좁은 폭에선 글자를 접고 아이콘만, `md`(768px)부터 원래 라벨
 * (원장 2026-09-01 *"좁은 폭에서 목록/반 정보 보기 접어줘"*). 768px은 ECS 반 목록이 좌우로
 * 갈리는 축과 **같은 값**이다(landing-list `md:grid-cols-2`) — ECS 안에서 좁고 넓음의 경계는 하나다.
 *
 * 🔴 **접는 것이지 없애는 것이 아니다** — 아이콘 알약은 그대로 눌린다. 좁은 폭에서 통째로 숨기면
 *    '반 정보 보기'는 이 화면에서 그 반으로 가는 **유일한 문**이라 갈 길이 사라진다(하부탭에만 있던
 *    셔틀 '오늘 등하원'이 폰에서 끊겼던 것과 같은 함정 — features/shuttle/faces.ts).
 * 🔴 두 상태 다 한쪽이 `display:none`이라 **접근성 이름이 비어 버린다** → 호출부가 `aria-label`을
 *    반드시 준다(이 조각 혼자로는 못 읽힌다). 넘기는 `hint`는 그 이름과 같은 말이어야 한다 —
 *    보이는 글자와 읽히는 이름이 갈리면 음성으로 조작하는 사람이 못 부른다.
 * ⚠️ 아이콘 자리는 `h-[18px]` — 12px 글자의 줄상자(preflight `line-height: 1.5`)와 **같은 높이**다.
 *    안 맞추면 접힌 알약만 4px 낮아져 바로 옆 요일 알약과 밑줄이 어긋난다.
 */
function PillGlyph({
  icon,
  hint,
  children,
}: {
  icon: AywaIconName;
  /** 접혔을 때의 툴팁 — `WindowLink`의 `title`은 **창 제목**이라 툴팁으로 안 쓰인다. */
  hint: string;
  children: string;
}) {
  return (
    <>
      <span className={SHEET_PILL_GLYPH_ICON} title={hint}>
        <EyIcon name={icon} size={14} />
      </span>
      <span className={SHEET_PILL_GLYPH_LABEL}>{children}</span>
    </>
  );
}

/**
 * 왼쪽 덩어리 — **목록 · 반 선택 · 반 정보 보기**.
 *
 * ⚠️ 반 선택은 [marker-trigger](@/components/ui/marker-trigger)의 노란 표기다 — "반을 골라 그 반의
 *    내용이 아래에 채워지는" 드롭다운이라는 조건에 월간도 똑같이 해당한다(그 파일의 🔑 조건).
 *    월간이 평범한 셀렉트였던 것이 두 화면이 가장 크게 갈려 보이던 지점이다.
 * 🔴 이동은 **호출부가 책임진다**(`onNavigate`) — 주간은 저장 큐, 월간은 목표 편집 큐를 먼저 비워야
 *    해서 순서가 화면마다 다르다. 여기서 `router.push`를 부르면 그 순서를 건너뛴다.
 */
export function SheetClassPicker({
  classId,
  classLabel,
  classOptions,
  onNavigate,
  hrefForClass,
  listHref = "/ecs",
  teacherName = null,
}: {
  classId: string;
  /** 지금 보고 있는 반 이름 — 툴팁·스크린리더 라벨에 쓴다. */
  classLabel: string;
  classOptions: { id: string; name: string }[];
  onNavigate: (href: string) => void | Promise<void>;
  /** 반을 바꿨을 때 갈 곳 — 주간은 보던 주를, 월간은 보던 달을 유지한다. */
  hrefForClass: (classId: string) => string;
  /**
   * 담임 이름 — 노란 반 표기 **안, 가장 오른쪽**에 이름만 적는다(원장 2026-09-02 *"담임을 반 옆에 적을것.
   * 반 이름 표기된 곳 가장 우측정렬로"* → *"ecs도 마찬가지"* → *"담임 이수진 → 이수진 정도만"*).
   * 🔴 '담임' 접두·별도 알약 금지. null이면 아무것도 안 그린다(담임 없는 반은 빈 자리).
   */
  teacherName?: string | null;
  /**
   * '목록'이 가는 곳 — 기본은 영어 랜딩(`/ecs`). 수학 시트(MCS 월간)는 **같은 조각**을 `/mcs`로 쓴다
   * (원장 2026-09-02 *"영어 ECS처럼 수학 MCS에 반정보가 있어야하는데 상단 헤더에 없음"*) —
   * 조각을 복사하면 두 시트의 상단 바가 다시 갈린다.
   */
  listHref?: string;
}) {
  // 화면 언어(2026-09-03) — provider 밖(MCS)에서는 한국어로 떨어진다([`lang-context`](../lang-context.tsx)).
  const t = useSheetT();
  const lang = useSheetLang();
  // 🔴 반 이름도 언어를 따른다(원장 2026-09-03) — 표기 교체는 `classNameFor` 한 곳이다.
  const showClass = (n: string) => classNameFor(n, lang);
  // 담임 이름도 같은 규약(*"선생님 이름도 영어선생님의 경우 영어 이름으로"*) — 표에 없으면 한국어 그대로.
  const shownTeacher = teacherNameFor(teacherName, useTeacherNames(), lang);
  return (
    <>
      <button
        type="button"
        className={`${sheetPill(false)} inline-flex items-center`}
        onClick={() => void onNavigate(listHref)}
        aria-label={t("chrome.list.aria")}
      >
        <PillGlyph icon="list" hint={t("chrome.list.aria")}>
          {t("chrome.list")}
        </PillGlyph>
      </button>
      <span className={`${MARKER_WIDTH} shrink-0`}>
        <SearchableSelect
          options={classOptions.map((c) => ({ value: c.id, label: showClass(c.name) }))}
          value={classId}
          onValueChange={(v) => {
            if (v && v !== classId) void onNavigate(hrefForClass(v));
          }}
          placeholder={t("chrome.classPlaceholder")}
          ariaLabel={t("chrome.classAria")}
          // ⚠️ `compact`를 안 쓴다 — 그건 쉐브론을 10px로 줄이는데(gap도 1) 21px 글자 옆에선
          //    흔적만 남는다.
          triggerClassName={MARKER_TRIGGER}
          // 담임 이름 — 표기 안 오른쪽 끝, 쉐브론 바로 왼쪽. 트리거 **안**의 꼬리표라 긴 반 이름은 남은 폭에서
          // 말줄임되고(위에 얹으면 끝이 덮여 사라졌다), 툴팁·클릭도 트리거의 것 그대로다.
          trailing={
            shownTeacher ? (
              <span
                className="text-text-dim text-base font-extrabold whitespace-nowrap"
                title={`${t("chrome.homeroom")} ${shownTeacher}`}
              >
                {shownTeacher}
              </span>
            ) : undefined
          }
          // 반이 수십 개라 목록에서 **지금 보고 있는 반**을 눈으로 못 찾겠다는 지적(원장 2026-08-06).
          highlightSelected
        />
      </span>
      {/* 반 정보 보기 — 드롭다운 **바로 옆**이라 "지금 고른 그 반"이라는 게 자리로 읽힌다.
          WindowLink라 창 안에선 드릴인, 최상위에선 새 창. */}
      <WindowLink
        href={`/classes/${classId}`}
        title={showClass(classLabel)}
        className={`${sheetPill(false)} inline-flex items-center`}
        ariaLabel={`${showClass(classLabel)} ${t("chrome.classInfo.suffix")}`}
      >
        <PillGlyph icon="info" hint={`${showClass(classLabel)} ${t("chrome.classInfo.suffix")}`}>
          {t("chrome.classInfo")}
        </PillGlyph>
      </WindowLink>
    </>
  );
}

/**
 * **주간 | 달력 | 진도표** — 같은 반을 보는 세 면의 전환.
 *
 * 기간 네비 **바로 옆**에 둔다: 여기가 "지금 이 반을 어느 기간·어느 모양으로 보고 있나"를 다루는 자리다.
 * 🔴 지금 보고 있는 면은 눌러도 아무 일도 안 한다 — 같은 화면을 다시 부르면 저장 flush만 도는 헛걸음이다.
 */
export function SheetFaceSwitch({
  current,
  faces = SHEET_FACES,
  onSelect,
}: {
  current: SheetFace;
  /**
   * 이 반이 열 수 있는 면 — 호출부가 [`sheetFacesFor(isEie)`](../chrome.ts)로 만든다.
   * 🔴 기본값은 **계획(MP) 없는 세 칸**이다 — 안 넘기면 EiE 아닌 반에 없는 문이 생긴다.
   */
  faces?: readonly SheetFace[];
  onSelect: (face: SheetFace) => void;
}) {
  const lang = useSheetLang();
  return (
    <span className={`${SHEET_SEG_BOX} shrink-0`}>
      {faces.map((face) => {
        const active = face === current;
        return (
          <button
            key={face}
            type="button"
            aria-pressed={active}
            title={sheetFaceTitle(face, lang)}
            onClick={() => {
              if (!active) onSelect(face);
            }}
            className={`${sheetSegItem(active)}`}
          >
            {sheetFaceLabel(face, lang)}
          </button>
        );
      })}
    </span>
  );
}
