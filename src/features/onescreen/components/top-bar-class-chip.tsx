import type { TodayClass } from "../server/roster";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { reportOptoutNotice } from "@/features/classes/report-optout";

/**
 * 반 필터 칩 한 개 — 내 반과 **위임받은 반**(0173a)이 같은 모양을 쓰되 색으로 갈린다.
 * 위임 반은 앰버(주의색) + 원 담임 이름을 툴팁으로 밝힌다: 지금 보고 있는 학생들이 남의 반 학생이라는
 * 사실이 화면에서 먼저 보여야, 내 반인 줄 알고 쓴 보고서가 학부모에게 나가는 일이 없다.
 */
export function ClassChip({
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
