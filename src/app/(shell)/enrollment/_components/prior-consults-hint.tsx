"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, ExternalLink } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { outcomeBadge } from "@/features/enrollment/outcome-meta";
import { phoneKeyOf } from "@/features/enrollment/same-person";

/**
 * 새 신규 콜&상담 작성 중 '이 학생의 이전 상담' 안내(원장 2026-10-19 *"같은 학생이 상담을 여러번 올 경우 체크"* 2번).
 * 같은 폼의 학생 이름·보호자 연락처·학교·학년 칸을 지켜보다가(입력이 멈추면 0.5초 뒤) `/api/enrollment/prior-consults`에 묻는다.
 * 판정은 카드 'N건' 배지·상세 '다른 상담'과 같은 한 벌(`same-person.ts`).
 * 🔴 이름만으로는 묻지 않는다 — 보호자 휴대폰이나 학교·학년이 함께 있어야 같은 학생을 가린다(동명이인).
 * 조회가 실패하면 안내만 안 뜬다(작성은 그대로). 입력칸이 없어 초안 자동저장에 끼지 않는다.
 * 이전 상담은 따로 창으로 연다(`frameTarget="window"` — 쓰던 작성 창이 상세로 바뀌지 않게).
 */
type Item = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  subject: string | null;
  outcome: string;
  consultedAt: string;
};

const FIELDS = new Set(["prospectName", "parentPhone", "prospectSchool", "prospectGrade"]);
type Hint = { items: Item[]; total: number };
const EMPTY: Hint = { items: [], total: 0 };

export function PriorConsultsHint() {
  const ref = useRef<HTMLDivElement>(null);
  const [{ items, total }, setHint] = useState<Hint>(EMPTY);
  const subjectMaps = useSubjectMaps();

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let timer: number | undefined;
    let ctrl: AbortController | null = null;
    let last = "";
    const value = (name: string) => {
      const el = form.elements.namedItem(name);
      return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value.trim() : "";
    };
    const run = () => {
      const name = value("prospectName");
      const phone = value("parentPhone");
      const school = value("prospectSchool");
      const grade = value("prospectGrade");
      if (!name || (!phoneKeyOf(phone) && !school && !grade)) {
        last = "";
        ctrl?.abort();
        setHint(EMPTY);
        return;
      }
      const qs = new URLSearchParams({ name, phone, school, grade }).toString();
      if (qs === last) return;
      last = qs;
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      fetch(`/api/enrollment/prior-consults?${qs}`, { signal: mine.signal, cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`prior-consults ${r.status}`);
          return r.json() as Promise<{ items?: Item[]; total?: number }>;
        })
        .then((j) => {
          if (!mine.signal.aborted) setHint({ items: j.items ?? [], total: j.total ?? j.items?.length ?? 0 });
        })
        .catch(() => {
          // 실패하면 안내를 비우고(앞 학생의 안내가 남지 않게) 같은 입력도 다음에 다시 묻는다.
          if (mine.signal.aborted) return;
          last = "";
          setHint(EMPTY);
        });
    };
    const onInput = (e: Event) => {
      const target = e.target as { name?: string } | null;
      if (!target?.name || !FIELDS.has(target.name)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 500);
    };
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    // 초안 복원·녹음 재진입으로 이미 채워진 값도 한 번 본다.
    timer = window.setTimeout(run, 300);
    return () => {
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      window.clearTimeout(timer);
      ctrl?.abort();
    };
  }, []);

  return (
    <div ref={ref} hidden={items.length === 0} className="border-amber/30 bg-amber-soft/30 rounded-xl border p-3" aria-live="polite">
      {items.length > 0 ? (
        <>
          <p className="text-foreground flex items-center gap-1.5 text-sm font-bold">
            <ClipboardList className="text-amber size-4" />
            이 학생의 이전 신규 콜&상담 <span className="num">{total}</span>건
            {total > items.length ? <span className="text-text-dim text-xs font-normal">(최근 {items.length}건)</span> : null}
          </p>
          <p className="text-text-dim mt-0.5 text-xs">같은 이름에 보호자 휴대폰 또는 학교·학년이 같은 상담입니다. 이전 상담 내용을 먼저 확인하세요.</p>
          <ul className="mt-2 space-y-1">
            {items.map((it) => {
              const badge = outcomeBadge(it.outcome);
              const meta = [it.subject ? subjectMaps.labelOf(it.subject) : null, [it.school, it.grade].filter(Boolean).join(" ") || null]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={it.id}>
                  <WindowLink
                    href={`/enrollment/${it.id}`}
                    title={it.name}
                    frameTarget="window"
                    className="bg-card hover:bg-bg-soft border-border flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 transition"
                  >
                    <span className="text-foreground flex min-w-0 items-center gap-2 text-sm">
                      <span className="num text-text-dim shrink-0">
                        {new Date(it.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                      </span>
                      {meta ? <span className="truncate">{meta}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${badge.class}`}>{badge.label}</span>
                      <ExternalLink className="text-text-faint size-3.5" />
                    </span>
                  </WindowLink>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
