"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pill } from "@/components/atoms/pill";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import { deleteClassTextbookPlan } from "@/features/textbooks/server/plan-actions";
import { undoPlanDelete } from "@/features/textbooks/server/plan-delete-actions";
import { groupSlotPicks } from "@/features/textbooks/lesson-schedule";
import type { ClassTextbookPlanRow } from "@/features/textbooks/types";
import { DialogShell, FIELD, FormError, useRun } from "./form-bits";
import { PlanPreviewDialog } from "./plan-preview-dialog";

/** 0268a 이전 배정 — 교시를 안 고르고 **축**으로 태웠다. `slotPicks`가 없을 때만 쓴다. */
const AXIS_LABEL: Record<string, string> = { class: "정규 수업", jj: "JJ 자습실" };
const PACE_LABEL: Record<string, string> = { period: "교시마다 1차수", day: "하루에 1차수", min25: "25분 1차수" };

/** 요일 글자 — 이 화면은 사무실만 보므로 한글 한 벌이면 된다(강사 시트는 사전을 쓴다). */
const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

/**
 * 고른 칸 → `"화 17:20 1·2차수 · 금 17:20 1차수"`. 자리(1·2차수, 원장 2026-10-16)가 없는 옛 값은 요일·시각만,
 * 요일도 없는 더 옛 값은 시각만 적는다. 묶음은 배정 창과 같은 [`groupSlotPicks`] 한 벌이다.
 */
function slotPicksLabel(picks: readonly string[]): string {
  return groupSlotPicks(picks)
    .map((g) => {
      const head = g.dow ? `${DOW_KO[g.dow] ?? g.dow} ${g.start}` : g.start;
      return g.positions.length > 0 ? `${head} ${g.positions.join("·")}차수` : head;
    })
    .join(" · ");
}

/**
 * 반 배정 면 — **읽기 전용**(원장 2026-09-16). 어디에 무엇이 깔려 있는지 보는 자리다.
 *
 * 🔴 **여기서 배정을 만들지 않는다** — 배정은 영어 강사 시트의 월간 화면에서 교시를 고르며 한다
 *    (원장 2026-09-16: *"반배정은 반배정 저기서 하지말고 여기서 교재 선택하고 몇차시에 할지 선택하면"*).
 *    들어가는 문이 둘이면 어느 쪽이 정본인지 헷갈리고, 시트 쪽만 교시 선택을 알고 있다.
 * 🔴 **여기서 실제 칸에 쓰지도 않는다**(원장 결정 D1, 2026-09-23) — 옛 [미리보기]→[기입] 문을 걷고
 *    읽기 전용 **월간계획 미리보기**로 바꿨다. 실제로 옮기는 길은 시트의 [월간계획 가져오기] 하나뿐이다.
 * 🔑 [배정 삭제]는 둔다(감사 F4) — 잘못 건 배정의 '계획'이 월간 달력에 계속 뜨는데 지울 곳이 없었다.
 *    삭제는 배정(=계획)만 지우고 이미 시트에 적은 실제 진도는 건드리지 않는다. 게이트는 서버(그 반 ECS 쓰기)이고,
 *    단추는 같은 게이트를 통과한 반(`deletableClassIds`)에만 그린다.
 * 🔑 반·교재 검색은 **화면 안에서** 거른다(감사 N7) — 목록은 한 번에 다 받으므로(fetch-once) 주소를 바꿔
 *    다시 조회할 이유가 없다.
 */
export function PlansFace({
  rows,
  skillAreas,
  deletableClassIds,
}: {
  rows: ClassTextbookPlanRow[];
  skillAreas: SkillAreaSetting[];
  /**
   * [배정 삭제]를 그릴 반 — page.tsx가 서버와 **같은 게이트**(그 반 ECS 쓰기, plan-delete-access.ts)로 고른다.
   * 여기 없는 반엔 단추를 그리지 않는다(원장 2026-11-05 읽기 권한 규칙 — write-lock.ts).
   */
  deletableClassIds: readonly string[];
}) {
  const deletable = useMemo(() => new Set(deletableClassIds), [deletableClassIds]);
  const [previewing, setPreviewing] = useState<ClassTextbookPlanRow | null>(null);
  const [deleting, setDeleting] = useState<ClassTextbookPlanRow | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [q, setQ] = useState("");

  const classOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.classId)) seen.set(r.classId, r.className);
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], "ko"))
      .map(([value, label]) => ({ value, label }));
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (!classFilter || r.classId === classFilter) && (!needle || r.textbookTitle.toLowerCase().includes(needle)),
  );
  const filtered = classFilter !== "" || needle !== "";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Toolbar>
        <SearchableSelect
          className="w-auto"
          value={classFilter}
          onValueChange={setClassFilter}
          placeholder="반"
          valuePrefix="반"
          ariaLabel="반 필터"
          options={[{ value: "", label: "전체" }, ...classOptions]}
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="교재이름 검색"
          aria-label="교재이름 검색"
          className={`${FIELD} w-44`}
        />
        <span className="text-text-dim text-xs">
          배정은 영어 강사 시트의 월간 화면에서 합니다 — 여기서는 어디에 무엇이 깔려 있는지 봅니다.
        </span>
      </Toolbar>

      {rows.length === 0 ? (
        <p className="text-text-dim px-1 py-8 text-center text-xs">배정된 교재가 없습니다.</p>
      ) : shown.length === 0 ? (
        <p className="text-text-dim px-1 py-8 text-center text-xs">
          조건에 맞는 배정이 없습니다.{" "}
          <button
            type="button"
            className="text-primary font-bold underline-offset-2 hover:underline"
            onClick={() => {
              setClassFilter("");
              setQ("");
            }}
          >
            조건 지우기
          </button>
        </p>
      ) : (
        <div className="overflow-x-auto px-1">
          {filtered ? (
            <p className="text-text-dim px-1 pb-1 text-xs">
              <span className="num">{shown.length}</span>건 / 전체 <span className="num">{rows.length}</span>건
            </p>
          ) : null}
          <table className="w-full border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
            <thead>
              <tr className="bg-bg-soft text-text-dim text-center text-xs">
                <th className="rounded-l-md py-1.5 pl-2 text-left font-bold">반</th>
                <th className="py-1.5 text-left font-bold">교재</th>
                <th className="py-1.5 font-bold">구분</th>
                <th className="py-1.5 font-bold">교시</th>
                <th className="py-1.5 font-bold">차수 단위</th>
                <th className="py-1.5 font-bold">시작</th>
                <th className="rounded-r-md py-1.5 font-bold">계획</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
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
                        <span className="num">{slotPicksLabel(p.slotPicks)}</span>
                      ) : (
                        (AXIS_LABEL[p.slotAxis] ?? p.slotAxis)
                      )}
                    </td>
                    <td className="py-1.5 text-center text-xs">{PACE_LABEL[p.pace] ?? p.pace}</td>
                    <td className="num py-1.5 text-center">{p.startDate.slice(5).replace("-", "/")}</td>
                    <td className="py-1.5 text-center">
                      <span className="inline-flex items-center gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => setPreviewing(p)}>
                          미리보기
                        </Button>
                        {deletable.has(p.classId) ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                            배정 삭제
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {previewing ? (
        <PlanPreviewDialog
          planId={previewing.id}
          className={previewing.className}
          textbookTitle={previewing.textbookTitle}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
      {deleting ? <DeletePlanDialog plan={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

/**
 * 배정 삭제 확인 — **무엇이 사라지고 무엇이 남는지**를 적는다(교재 삭제 확인과 같은 규약).
 * 🔴 게이트는 서버(`deleteClassTextbookPlan` → 그 반 ECS 쓰기)다 — 이 창은 게이트가 아니다([[#77]]).
 */
function DeletePlanDialog({ plan, onClose }: { plan: ClassTextbookPlanRow; onClose: () => void }) {
  const { busy, error, run } = useRun();
  const router = useRouter();
  // 진도 줄도 함께 지우기(원장 2026-10-19) — 기본 켬. 범위는 서버(`clearPlanLines`)가 정한다.
  const [withLines, setWithLines] = useState(true);
  return (
    <DialogShell title={`배정 삭제 — ${plan.className} · ${plan.textbookTitle}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          이 배정으로 계산되던 <b>월간계획</b>이 영어 강사 시트에서 사라집니다.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={withLines}
            disabled={busy}
            onChange={(e) => setWithLines(e.target.checked)}
          />
          <span>
            <b>이 교재로 들어간 진도 줄도 함께 지우기</b>
            <br />
            <span className="text-text-dim">
              오늘 이후 · 모든 요일의 이 교재 줄과 그 칸의 미룸·당김 기록. 선생님이 고쳐 쓴 줄 · 다른 교재 · 지난 수업은
              그대로 남습니다.
            </span>
          </span>
        </label>
        <FormError error={error} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void run(() => deleteClassTextbookPlan(plan.id, { withLines })).then((res) => {
                if (!res || !res.ok) return;
                const undo = res.undo;
                const undoAction = undo
                  ? {
                      duration: 10_000,
                      action: {
                        label: "되돌리기",
                        onClick: () => {
                          void undoPlanDelete({
                            classId: plan.classId,
                            plan: undo.plan,
                            lines: undo.lines,
                            historyId: res.historyId,
                          }).then((u) => {
                            if (!u.ok) return void toast.error(u.error);
                            if (u.warning) toast.warning(u.warning);
                            else toast.success("배정을 되돌렸습니다");
                            router.refresh();
                          });
                        },
                      },
                    }
                  : undefined;
                if (res.warning) toast.warning(res.warning, undoAction);
                else if (res.cleared) toast.success(`배정과 진도 ${res.cleared.lines}줄을 지웠습니다`, undoAction);
                else toast.success("배정을 삭제했습니다", undoAction);
                onClose();
              });
            }}
          >
            {busy ? "삭제 중…" : "배정 삭제"}
          </Button>
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
