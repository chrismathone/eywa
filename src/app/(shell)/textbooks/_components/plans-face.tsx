"use client";

import { useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import type { AssignableClass } from "@/features/textbooks/server/queries";
import type { ClassTextbookPlanRow } from "@/features/textbooks/types";
import { PlanDialog } from "./plan-dialog";
import { ApplyDialog } from "./apply-dialog";

const AXIS_LABEL: Record<string, string> = { class: "정규 수업", jj: "JJ 자습실" };
const PACE_LABEL: Record<string, string> = { period: "교시마다 1차수", day: "하루에 1차수" };

/** "2026-09-16T05:00:00Z" → "9/16" (없으면 null). */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 반 배정 면 — 어느 반의 어느 축에 어떤 교재를 어떤 단위로 태울지.
 *
 * 🔴 **배정을 만드는 것만으로는 아무 칸도 안 바뀐다** — [기입]을 눌러야 계획 줄이 채워진다(자동 쓰기 없음).
 * 🔴 기입은 **빈 칸만** 채운다 — 잘못 눌러도 잃을 게 없고, 같은 배정을 다시 눌러도 안전하다.
 */
export function PlansFace({
  rows,
  classes,
  books,
  skillAreas,
  canAssign,
}: {
  rows: ClassTextbookPlanRow[];
  classes: AssignableClass[];
  books: { id: string; title: string; skillArea: string | null; sessionCount: number }[];
  skillAreas: SkillAreaSetting[];
  canAssign: boolean;
}) {
  const [editing, setEditing] = useState<ClassTextbookPlanRow | "new" | null>(null);
  const [applying, setApplying] = useState<ClassTextbookPlanRow | null>(null);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Toolbar>
        <span className="text-text-dim text-xs">
          배정을 만든 뒤 <b>기입</b>을 눌러야 시트에 들어갑니다 — 이미 적혀 있는 칸은 그대로 둡니다.
        </span>
        {canAssign ? (
          <ToolbarButton
            variant="primary"
            className="ml-auto"
            disabled={classes.length === 0 || books.length === 0}
            title={
              books.length === 0
                ? "배정할 수 있는 교재가 없습니다 — 구분과 차수가 정해진 교재만 배정할 수 있습니다"
                : classes.length === 0
                  ? "담당하는 영어 반이 없습니다"
                  : undefined
            }
            onClick={() => setEditing("new")}
          >
            새 배정
          </ToolbarButton>
        ) : null}
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
                <th className="py-1.5 font-bold">축</th>
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
                      <button
                        type="button"
                        className="hover:text-primary text-left"
                        onClick={() => setEditing(p)}
                        title="배정 수정·삭제"
                      >
                        {p.textbookTitle}
                        <span className="text-text-faint num ml-1.5 text-xs">
                          {p.startLessonNo > 1 ? `${p.startLessonNo}~` : ""}
                          {p.sessionCount}차수
                        </span>
                      </button>
                    </td>
                    <td className="py-1.5 text-center">
                      {p.skillArea ? (
                        <Pill color={known ? skillAreaColorOf(skillAreas, p.skillArea) : "neutral"}>{label}</Pill>
                      ) : (
                        <span className="text-text-faint text-xs">미지정</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center text-xs">{AXIS_LABEL[p.slotAxis] ?? p.slotAxis}</td>
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

      {editing ? (
        <PlanDialog
          plan={editing === "new" ? null : editing}
          classes={classes}
          books={books}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {applying ? <ApplyDialog plan={applying} onClose={() => setApplying(null)} /> : null}
    </div>
  );
}
