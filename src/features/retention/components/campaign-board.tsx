"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { EyIcon } from "@/components/icons/aywa-icons";
import { campaignAdd, campaignSetStatus, campaignRemove, type CampaignResult } from "../server/actions";
import type { CampaignBoard as Board, CampaignStatus } from "../server/campaign-queries";

const COLUMN_CAP = 10;
const CANDIDATE_CAP = 24;

const COLUMNS: { key: CampaignStatus; label: string; color: PillColor }[] = [
  { key: "pending", label: "대상", color: "amber" },
  { key: "contacted", label: "연락함", color: "blue" },
  { key: "enrolled", label: "재등록 완료", color: "primary" },
  { key: "declined", label: "이탈", color: "rose" },
];

/**
 * 재등록 캠페인 보드 — KPI + 후보 스트립 + 4열 퍼널 칸반. 상태 전환은 서버 액션(transition).
 * `canWrite` = 서버 게이트(`campaignAdd`·`campaignSetStatus`·`campaignRemove`)와 같은 `canWriteTenant(…,"retention")`를 page가 계산 —
 * 읽기 권한이면 추가·상태 전환·제거 단추를 그리지 않고 보드만 보인다(원장 2026-11-05, src/lib/write-lock.ts).
 */
export function CampaignBoard({ board, canWrite }: { board: Board; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  function run(fn: () => Promise<CampaignResult>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(okMsg);
      else toast.error(r.error ?? "오류가 발생했습니다");
    });
  }
  const { stats, candidates, columns } = board;

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {[
          { label: "대상", v: stats.pending, c: "text-amber" },
          { label: "연락함", v: stats.contacted, c: "text-blue" },
          { label: "재등록", v: stats.enrolled, c: "text-primary" },
          { label: "이탈", v: stats.declined, c: "text-rose" },
          {
            label: "재등록률",
            v: stats.reenrollRate == null ? "—" : `${stats.reenrollRate}%`,
            c: "text-foreground",
          },
        ].map((k) => (
          <div key={k.label} className="bg-card border-line shadow-card rounded-2xl border p-4">
            <p className="micro truncate">{k.label}</p>
            <p className={`tabular mt-2 text-2xl leading-none font-bold ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* 후보 */}
      {candidates.length > 0 ? (
        <div className="bg-card border-line shadow-card rounded-2xl border p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="micro">재등록 위험 후보</span>
            <span className="text-text-faint text-xs">{candidates.length}명{canWrite ? " — 캠페인에 추가하세요" : ""}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(showAllCandidates ? candidates : candidates.slice(0, CANDIDATE_CAP)).map((c) => (
              <div
                key={c.studentId}
                className="border-line flex items-center gap-2.5 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-foreground text-xs leading-tight font-bold">{c.name}</div>
                  <div className="text-text-faint text-xs">
                    {[c.grade, c.school].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Pill color={c.renewalTone === "risk" ? "danger" : "amber"}>재등록 {c.renewalLabel}</Pill>
                <span className="text-text-dim num text-xs">{c.feeLabel}</span>
                {canWrite ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => campaignAdd(c.studentId), `${c.name} — 캠페인 추가`)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
                  >
                    추가
                  </button>
                ) : null}
              </div>
            ))}
            {!showAllCandidates && candidates.length > CANDIDATE_CAP ? (
              <button
                type="button"
                onClick={() => setShowAllCandidates(true)}
                className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg border border-dashed px-3 py-2 text-xs transition"
              >
                <EyIcon name="chevronDown" size={12} aria-hidden="true" />
                {candidates.length - CANDIDATE_CAP}명 더 보기
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 퍼널 칸반 */}
      <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
        <div className="flex min-w-[780px] gap-3 p-3">
          {COLUMNS.map((col) => {
            const list = columns[col.key];
            const expanded = expandedCols.has(col.key);
            const visible = expanded ? list : list.slice(0, COLUMN_CAP);
            const rest = list.length - visible.length;
            return (
            <div key={col.key} className="min-w-[185px] flex-1">
              <div className="mb-2 flex items-center gap-1.5">
                <Pill color={col.color}>{col.label}</Pill>
                <span className="text-text-faint num text-xs">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <div className="border-line text-text-faint rounded-lg border border-dashed px-3 py-6 text-center text-xs">
                    비어 있음
                  </div>
                ) : (
                  <>
                  {visible.map((card) => (
                    <div key={card.targetId} className="bg-bg-soft/40 border-line rounded-lg border p-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-foreground truncate text-xs font-bold">{card.name}</div>
                          <div className="text-text-faint truncate text-xs">
                            {[card.grade, card.school, card.teacherName].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <span className="text-text-dim num shrink-0 text-xs">{card.feeLabel}</span>
                      </div>
                      {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.status === "pending" ? (
                          <Btn
                            label="연락함"
                            disabled={pending}
                            onClick={() => run(() => campaignSetStatus(card.targetId, "contacted"), `${card.name} — 연락함`)}
                          />
                        ) : null}
                        {card.status === "contacted" ? (
                          <>
                            <Btn
                              label="재등록"
                              primary
                              disabled={pending}
                              onClick={() => run(() => campaignSetStatus(card.targetId, "enrolled"), `${card.name} — 재등록 완료`)}
                            />
                            <Btn
                              label="이탈"
                              disabled={pending}
                              onClick={() => run(() => campaignSetStatus(card.targetId, "declined"), `${card.name} — 이탈 처리`)}
                            />
                          </>
                        ) : null}
                        {card.status === "enrolled" || card.status === "declined" ? (
                          <Btn
                            label="되돌리기"
                            disabled={pending}
                            onClick={() => run(() => campaignSetStatus(card.targetId, "contacted"), "되돌렸습니다")}
                          />
                        ) : null}
                        <Btn
                          label="제거"
                          disabled={pending}
                          onClick={() => run(() => campaignRemove(card.targetId), `${card.name} — 캠페인에서 제거`)}
                        />
                      </div>
                      ) : null}
                    </div>
                  ))}
                  {rest > 0 ? (
                    <button
                      type="button"
                      data-no-drag-scroll
                      onClick={() => setExpandedCols((s) => new Set(s).add(col.key))}
                      className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-xs transition"
                    >
                      <EyIcon name="chevronDown" size={12} aria-hidden="true" />
                      {rest}개 더 보기
                    </button>
                  ) : null}
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </DragScrollArea>
    </div>
  );
}

function Btn({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-no-drag-scroll
      className={`rounded-lg px-2 py-0.5 text-xs transition disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-line text-text-dim hover:bg-bg-soft border"
      }`}
    >
      {label}
    </button>
  );
}
