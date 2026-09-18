"use client";

import { useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import type { ClassTextbookPlanRow } from "@/features/textbooks/types";
import { ApplyDialog } from "./apply-dialog";

/** 0268a 이전 배정 — 교시를 안 고르고 **축**으로 태웠다. `slotPicks`가 없을 때만 쓴다. */
const AXIS_LABEL: Record<string, string> = { class: "정규 수업", jj: "JJ 자습실" };
const PACE_LABEL: Record<string, string> = { period: "교시마다 1차수", day: "하루에 1차수" };

/** 요일 글자 — 이 화면은 사무실만 보므로 한글 한 벌이면 된다(강사 시트는 사전을 쓴다). */
const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

/** `"mon|17:20"` → `"월 17:20"`. 요일이 없는 옛 값은 시각만 적는다. */
function slotPickLabel(pick: string): string {
  const bar = pick.indexOf("|");
  if (bar < 0) return pick;
  return `${DOW_KO[pick.slice(0, bar)] ?? pick.slice(0, bar)} ${pick.slice(bar + 1)}`;
}

/** "2026-09-16T05:00:00Z" → "9/16" (없으면 null). */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 반 배정 면 — **읽기 전용**(원장 2026-09-16). 어디에 무엇이 깔려 있는지 보는 자리다.
 *
 * 🔴 **여기서 배정을 만들지 않는다** — 배정은 영어 강사 시트의 월간 화면에서 교시를 고르며 한다
 *    (원장 2026-09-16: *"반배정은 반배정 저기서 하지말고 여기서 교재 선택하고 몇차시에 할지 선택하면"*).
 *    들어가는 문이 둘이면 어느 쪽이 정본인지 헷갈리고, 시트 쪽만 교시 선택을 알고 있다.
 * 🔴 [미리보기]는 남는다 — 이미 있는 배정을 **다시 깔 때** 쓰는 문이고, 그 창 안에서 [기입]을 누르기
 *    전까지는 아무것도 안 바뀐다. 기입은 **빈 칸만** 채운다(덮어쓰기 없음).
 */
export function PlansFace({ rows, skillAreas }: { rows: ClassTextbookPlanRow[]; skillAreas: SkillAreaSetting[] }) {
  const [applying, setApplying] = useState<ClassTextbookPlanRow | null>(null);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Toolbar>
        <span className="text-text-dim text-xs">
          배정은 영어 강사 시트의 월간 화면에서 합니다 — 여기서는 어디에 무엇이 깔려 있는지 봅니다.
        </span>
      </Toolbar>

      {rows.length === 0 ? (
        <p className="text-text-dim px-1 py-8 text-center text-xs">배정된 교재가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto px-1">
          <table className="w-full border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
            <thead>
              <tr className="bg-bg-soft text-text-dim text-center text-xs">
                <th className="rounded-l-md py-1.5 pl-2 text-left font-bold">반</th>
                <th className="py-1.5 text-left font-bold">교재</th>
                <th className="py-1.5 font-bold">구분</th>
                <th className="py-1.5 font-bold">교시</th>
                <th className="py-1.5 font-bold">차수 단위</th>
                <th className="py-1.5 font-bold">시작</th>
                <th className="py-1.5 font-bold">마지막 기입</th>
                <th className="rounded-r-md py-1.5 font-bold">기입</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const { label, known } = skillAreaLabelOf(skillAreas, p.skillArea ?? "");
                return (
                  <tr key={p.id} className="border-line-faint border-b last:border-0">
                    <td className="py-1.5 pl-2 font-bold">{p.className}</td>
                    <td className="py-1.5">
                      {p.textbookTitle}
                      <span className="text-text-faint num ml-1.5 text-xs">
                        {p.startLessonNo > 1 ? `${p.startLessonNo}~` : ""}
                        {p.sessionCount}차수
                      </span>
                    </td>
                    <td className="py-1.5 text-center">
                      {p.skillArea ? (
                        <Pill color={known ? skillAreaColorOf(skillAreas, p.skillArea) : "neutral"}>{label}</Pill>
                      ) : (
                        <span className="text-text-faint text-xs">미지정</span>
                      )}
                    </td>
                    {/* 고른 칸이 있으면 **요일·시각**을 그대로 보여 준다 — 축(정규/JJ)은 0268a 이전 배정의 폴백이다. */}
                    <td className="py-1.5 text-center text-xs">
                      {p.slotPicks ? (
                        <span className="num">{p.slotPicks.map(slotPickLabel).join(" · ")}</span>
                      ) : (
                        (AXIS_LABEL[p.slotAxis] ?? p.slotAxis)
                      )}
                    </td>
                    <td className="py-1.5 text-center text-xs">{PACE_LABEL[p.pace] ?? p.pace}</td>
                    <td className="num py-1.5 text-center">{p.startDate.slice(5).replace("-", "/")}</td>
                    <td className="num py-1.5 text-center">
                      {shortDate(p.lastAppliedAt) ?? <span className="text-text-faint">—</span>}
                    </td>
                    <td className="py-1.5 text-center">
                      <Button type="button" size="sm" variant="outline" onClick={() => setApplying(p)}>
                        미리보기
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {applying ? <ApplyDialog plan={applying} onClose={() => setApplying(null)} /> : null}
    </div>
  );
}
