"use client";

// 좌측 계획 패널 — 담임/부담임 × 월간/주간 목표(행 × [교재명, 목표 진도]) + 패널 메모.
// 시트 원본의 "담임 월간계획/주간계획·부담임 월간계획/주간계획" 4구획을 아코디언으로 이식. LWW 자동저장.
// 행은 반 트랙별(원장 2026-09-14 — EiE = 달력 칸 `In-class · Homework · Test` / 그 외 = 6영역):
// 호출부가 `goalAreasFor`로 골라 넘긴다. 이 파일은 받은 목록을 그리기만 한다.
import { useSheetT } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import type { SheetGoalDTO } from "../server/queries";
import { SHEET_BOX_FRAME, SHEET_INPUT, SHEET_TEXTAREA } from "../ui-box";
import { writeLockedPlaceholder } from "@/lib/write-lock";

const SECTIONS: { role: "homeroom" | "assistant"; scope: "month" | "week"; title: SheetDictKey }[] = [
  { role: "homeroom", scope: "month", title: "plan.panel.homeroom.month" },
  { role: "homeroom", scope: "week", title: "plan.panel.homeroom.week" },
  { role: "assistant", scope: "month", title: "plan.panel.assistant.month" },
  { role: "assistant", scope: "week", title: "plan.panel.assistant.week" },
];

export function PlanPanel({
  goals,
  skillAreas,
  canEdit,
  lockedHint,
  monthStart,
  weekMonday,
  memo,
  onGoalField,
  onMemo,
}: {
  goals: SheetGoalDTO[];
  /** 왼쪽 표의 행 — 교시 계획 줄의 영역 목록이 아니다(EiE는 둘이 다르다). */
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  /** 잠긴 이유가 권한 부족이 아닐 때(담당 반 아님 등) 쓸 안내. 없으면 권한 안내(writeLockedPlaceholder). */
  lockedHint?: string;
  monthStart: string;
  weekMonday: string;
  memo: string;
  onGoalField: (
    scope: "month" | "week",
    role: "homeroom" | "assistant",
    skillArea: string,
    field: "textbook" | "targetProgress",
    value: string,
  ) => void;
  onMemo: (body: string) => void;
}) {
  const t = useSheetT();
  const lockedTitle = canEdit ? undefined : (lockedHint ?? writeLockedPlaceholder("ecs"));
  const goalOf = (scope: string, role: string, area: string) =>
    goals.find(
      (g) =>
        g.scope === scope &&
        g.role === role &&
        g.skillArea === area &&
        g.periodStart === (scope === "month" ? monthStart : weekMonday),
    );

  return (
    // 폰(`phone:` = 최상위 프레임 <768px)은 시트 위에 쌓이므로(sheet-client `phone:flex-col`) 폭은 전부, 높이는 35vh로 캡해 아래
    // 시트 자리를 남긴다(안 캡하면 첫 섹션이 펼쳐진 패널 ~900px이 화면을 다 먹는다 — 안엔 overflow-y-auto라 패널 안에서 스크롤).
    <aside className="bg-card shadow-card w-[300px] shrink-0 self-start overflow-y-auto rounded-2xl p-2.5 phone:max-h-[35vh] phone:w-full">
      <div className="space-y-1">
        {SECTIONS.map((sec, i) => (
          <details key={`${sec.role}-${sec.scope}`} className="group" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1 select-none [&::-webkit-details-marker]:hidden">
              <EyIcon
                name="chevronRight"
                size={11}
                className="text-text-faint transition-transform group-open:rotate-90"
              />
              <span className="text-foreground text-sm font-bold">{t(sec.title)}</span>
              <span className="text-foreground num ml-auto text-xs font-bold">
                {sec.scope === "month" ? monthStart.slice(0, 7) : t("plan.panel.thisWeek")}
              </span>
            </summary>
            {/* 🔴 표 하나 + 줄마다 subgrid — 영역 칸 폭 = **가장 긴 라벨**(하한 74px · 상한 96px).
                줄마다 따로 74px 고정 grid였을 땐 EiE `Homework`(굵게 14px ≈ 71px)가 칸 안 64px에 못 들어가
                `Homew…`로 잘렸다(2026-09-14 Pretendard 실측). 6영역은 가장 긴 `Speaking`(≈62px)도 74px 안이라
                하한에 걸려 **종전과 같은 폭**이다 · 상한은 학원이 긴 라벨을 적어도 입력 칸을 다 먹지 않게(넘치면 잘림+title). */}
            <div className="grid grid-cols-[minmax(74px,max-content)_1fr_1fr] gap-1 px-1 pt-1 pb-2">
              {/* 열 머리글 — 시트의 '교재명 / 목표 진도' 머리줄. faint 10px는 안 읽혀 11px 굵게로. */}
              <div className="text-foreground bg-bg-soft col-span-3 grid grid-cols-subgrid rounded-md py-0.5 text-xs font-bold">
                <span />
                <span className="pl-1">{t("month.goal.book")}</span>
                <span>{t("plan.panel.progress")}</span>
              </div>
              {skillAreas.map((area) => {
                const g = goalOf(sec.scope, sec.role, area.key);
                return (
                  <div key={area.key} className="col-span-3 grid grid-cols-subgrid items-center">
                    {/* 영역 = 고유색 알약 + 굵게(원장 지시 2026-07-31 "아 보카네! 같은 느낌").
                        색은 학원설정 단일 소스(skillAreaColorOf) — 여기서 이름별 색을 박지 말 것. */}
                    <span
                      // 계획 표의 '구분' 칸과 **같은 박스**(잉크 테두리·h-6) — 영역 구분은 바탕색이 진다.
                      className={`${SHEET_BOX_FRAME} inline-flex h-6 w-full max-w-24 items-center justify-center truncate px-1 text-xs font-bold ${
                        SUBJECT_SOFT[skillAreaColorOf(skillAreas, area.key)]
                      }`}
                      title={area.label}
                    >
                      {area.label}
                    </span>
                    {/* 읽기 권한이면 **비활성**(readOnly는 활성 칸처럼 보였다) + 툴팁 안내 — 칸이 24개라 문구를
                        칸마다 박지 않는다(시트 머리 한 줄 = sheet-client.tsx). */}
                    <input
                      className={SHEET_INPUT}
                      defaultValue={g?.textbook ?? ""}
                      disabled={!canEdit}
                      title={lockedTitle}
                      aria-label={`${t(sec.title)} ${area.label} ${t("month.goal.book")}`}
                      onChange={(e) => onGoalField(sec.scope, sec.role, area.key, "textbook", e.target.value)}
                    />
                    <input
                      className={SHEET_INPUT}
                      defaultValue={g?.targetProgress ?? ""}
                      disabled={!canEdit}
                      title={lockedTitle}
                      aria-label={`${t(sec.title)} ${area.label} ${t("plan.panel.progress")}`}
                      onChange={(e) =>
                        onGoalField(sec.scope, sec.role, area.key, "targetProgress", e.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <div className="border-line-strong mt-1.5 border-t pt-1.5">
        <span className="text-foreground text-xs font-bold">{t("plan.panel.memo")}</span>
        {/* 메모는 한 칸이라 자리 표시 글로 권한을 안내한다(비어 있을 때). SHEET_TEXTAREA엔 비활성 모양이 없어 여기서 더한다. */}
        <textarea
          className={`${SHEET_TEXTAREA} mt-1 min-h-[56px] disabled:opacity-60`}
          defaultValue={memo}
          disabled={!canEdit}
          placeholder={lockedTitle}
          aria-label={t("plan.panel.memo")}
          onChange={(e) => onMemo(e.target.value)}
        />
      </div>
    </aside>
  );
}
