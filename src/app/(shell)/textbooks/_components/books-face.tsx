"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pill } from "@/components/atoms/pill";
import { Toolbar, ToolbarButton, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { FIELD } from "./form-bits";
import { TextbookDialog } from "./textbook-dialog";
import { CoverThumb } from "./cover-thumb";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import type { TextbookListItem } from "@/features/textbooks/types";

/**
 * 교재 면 — 툴바(검색·구분 필터) + 표.
 *
 * 🔴 필터는 **주소(searchParams)** 로 건다 — 서버가 목록을 좁혀 내려주므로 클라 상태로 두면 페이지를
 *    넘길 때마다 조건이 사라진다. 툴바 부품은 규약대로 `<Toolbar>`/`<ToolbarSegment>`/`<ToolbarChip>`이고
 *    치수를 손으로 적지 않는다(toolbar-canon).
 * 🔴 목록에 **사진 + 교재이름**을 함께 세운다(원장 2026-09-16 *"목록에서 사진 교재이름 이런식으로
 *    목록에서 바로볼수있게"*).
 * ⚠️ '폐지 포함' 토글은 없다 — 폐지(감추기)를 **삭제**로 바꿨다(원장 2026-09-16 *"여기 폐지말고 삭제로
 *    변경"*). 감출 방법이 사라졌으니 목록은 **전부** 세운다(그래야 폐지로 남아 있던 옛 행도 지울 수 있다).
 */
export function BooksFace({
  rows,
  total,
  page,
  pageSize,
  skillAreas,
  canWrite,
  canImport = false,
}: {
  rows: TextbookListItem[];
  total: number | null;
  page: number;
  pageSize: number;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  /** 엑셀 가져오기(교재·차수) — 서버가 올리기 주소와 같은 `canManageTenant`로 정한 값. */
  canImport?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState<{ mode: "create" } | { mode: "edit"; id: string } | null>(null);

  const area = sp.get("area") ?? "";
  const q = sp.get("q") ?? "";

  function go(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // 조건이 바뀌면 1쪽으로 — 안 그러면 3쪽을 보던 사람이 빈 화면을 본다.
    if (!("page" in next)) params.delete("page");
    router.push(`/textbooks?${params.toString()}`);
  }

  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Toolbar>
        <form
          className="flex shrink-0 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: String(new FormData(e.currentTarget).get("q") ?? "") });
          }}
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="교재이름 검색"
            aria-label="교재이름 검색"
            className={`${FIELD} w-44`}
          />
          <ToolbarButton type="submit">검색</ToolbarButton>
        </form>
        {/* 엑셀 가져오기 — 검색과 같은 줄(원장 2026-09-29 통일 — 이름은 ExcelMenu 한 곳). */}
        {canImport ? <ExcelMenu importKind="textbooks" /> : null}

        <ToolbarSegment label="구분" wrap>
          <ToolbarSegmentItem active={area === ""} onClick={() => go({ area: null })}>
            전체
          </ToolbarSegmentItem>
          {skillAreas.map((a) => (
            <ToolbarSegmentItem key={a.key} active={area === a.key} onClick={() => go({ area: a.key })}>
              {a.label}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>

        {canWrite ? (
          <ToolbarButton variant="primary" className="ml-auto" onClick={() => setOpen({ mode: "create" })}>
            교재 등록
          </ToolbarButton>
        ) : null}
      </Toolbar>

      {rows.length === 0 ? (
        <p className="text-text-dim px-1 py-8 text-center text-xs">
          {q || area ? "조건에 맞는 교재가 없습니다." : "등록된 교재가 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto px-1">
          <table className="w-full border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
            <colgroup>
              <col style={{ width: 300 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 72 }} />
            </colgroup>
            <thead>
              <tr className="bg-bg-soft text-text-dim text-center text-xs">
                <th className="rounded-l-md py-1.5 pl-2 text-left font-bold">교재</th>
                <th className="py-1.5 font-bold">구분</th>
                <th className="py-1.5 font-bold">페이지/시간</th>
                <th className="py-1.5 font-bold">차수</th>
                <th className="py-1.5 font-bold" title="진도·과제가 하나라도 적힌 차수 수">
                  작성한 차수
                </th>
                <th className="rounded-r-md py-1.5 font-bold">배정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const { label, known } = skillAreaLabelOf(skillAreas, r.skillArea ?? "");
                return (
                  <tr key={r.id} className="border-line-faint border-b last:border-0">
                    <td className="py-1.5 pl-2">
                      <button
                        type="button"
                        className="hover:text-primary flex w-full items-center gap-2 text-left"
                        onClick={() => setOpen({ mode: "edit", id: r.id })}
                        title={canWrite ? "교재 수정 · 차수별 진도·과제" : "교재 보기 · 차수별 진도·과제"}
                      >
                        <CoverThumb src={r.coverUrl} alt="" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{r.title}</span>
                        </span>
                      </button>
                    </td>
                    <td className="py-1.5 text-center">
                      {r.skillArea ? (
                        <Pill color={known ? skillAreaColorOf(skillAreas, r.skillArea) : "neutral"}>{label}</Pill>
                      ) : (
                        <span className="text-text-faint text-xs">미지정</span>
                      )}
                    </td>
                    <td className="num py-1.5 text-center">{r.pageTime ?? <span className="text-text-faint">—</span>}</td>
                    <td className="num py-1.5 text-center">{r.sessionCount > 0 ? r.sessionCount : <span className="text-text-faint">—</span>}</td>
                    {/* 🔴 건수를 **모르면**(조회 실패) 숫자 대신 '?' — `0/20`은 "하나도 안 적었다"는 거짓말이다. */}
                    <td className="num py-1.5 text-center">
                      {r.sessionCount === 0 ? (
                        <span className="text-text-faint">—</span>
                      ) : r.filledLessons === null ? (
                        <span className="text-text-faint" title="지금은 셀 수 없었습니다 — 새로고침해 보세요">
                          ?/{r.sessionCount}
                        </span>
                      ) : (
                        <span className={r.filledLessons === 0 ? "text-text-faint" : ""}>
                          {r.filledLessons}/{r.sessionCount}
                        </span>
                      )}
                    </td>
                    <td className="num py-1.5 text-center">
                      {r.planCount === null ? (
                        <span className="text-text-faint" title="지금은 셀 수 없었습니다 — 새로고침해 보세요">
                          ?
                        </span>
                      ) : r.planCount > 0 ? (
                        `${r.planCount}개 반`
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages !== null && totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2 py-2">
          <ToolbarButton disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
            이전
          </ToolbarButton>
          <span className="num text-text-dim text-xs">
            {page} / {totalPages}
          </span>
          <ToolbarButton disabled={page >= totalPages} onClick={() => go({ page: String(page + 1) })}>
            다음
          </ToolbarButton>
        </div>
      ) : null}

      {open ? (
        <TextbookDialog
          mode={open.mode}
          textbookId={open.mode === "edit" ? open.id : null}
          skillAreas={skillAreas}
          canWrite={canWrite}
          planCount={open.mode === "edit" ? (rows.find((r) => r.id === open.id)?.planCount ?? null) : null}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
