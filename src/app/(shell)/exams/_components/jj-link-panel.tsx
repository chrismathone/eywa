"use client";

/**
 * 짝 잇기 패널 — 후보를 골라 한 명씩, 목록에서 직접 찾아서, 또는 '이름이 하나뿐인 학생 한 번에'.
 * 판정(누가 유일한가)과 권한은 서버가 다시 한다(link-actions.ts) — 이 화면은 고르고 확인하는 자리만 준다(#77).
 * 🔴 **고르기와 잇기를 가른다**(적대 리뷰 2026-09-10) — 누르면 곧바로 잇던 첫 구현은 검색 목록의 Enter 한 번에
 *    목록 첫 줄 아이가 이어지고 그 행이 사라져 아무도 몰랐다. 이제 확인 줄에서 양쪽 이름을 보고 누른다.
 *    '한 번에 연결'도 누르면 이을 짝 목록이 먼저 펼쳐진다.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/ui/searchable-select";
import { linkIjwStudent, linkIjwUniqueMatches } from "@/features/ijw/server/link-actions";
import { JjLinkRowItem, ijwSideLabel, type JjLinkRow } from "./jj-link-row";

export type { JjLinkRow } from "./jj-link-row";
export type JjPoolOption = { id: string; label: string };

export function JjLinkPanel({ rows, pool }: { rows: JjLinkRow[]; pool: JjPoolOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pending, start] = useTransition();
  const uniqueRows = rows.filter((r) => r.uniqueId);
  const poolOptions = useMemo<ComboOption[]>(() => pool.map((p) => ({ value: p.id, label: p.label })), [pool]);

  function linkOne(row: JjLinkRow, studentId: string, studentLabel: string, done: () => void) {
    start(async () => {
      const res = await linkIjwStudent({ ijwId: row.ijwId, studentId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${ijwSideLabel(row)} ↔ ${studentLabel} 연결했습니다`);
      done();
      router.refresh();
    });
  }

  /** 확인 목록에 **보여 준 짝 그대로** 보낸다 — 서버는 이 중 여전히 유일한 것만 잇고, 빠진 것은 돌려준다. */
  function linkAllUnique() {
    const pairs = uniqueRows.map((r) => ({ ijwId: r.ijwId, studentId: r.uniqueId as string }));
    const labelOf = new Map(uniqueRows.map((r) => [r.ijwId, ijwSideLabel(r)]));
    const names = (ids: string[]) => {
      const head = ids.slice(0, 5).map((id) => labelOf.get(id) ?? id).join(", ");
      return ids.length > 5 ? `${head} 외 ${ids.length - 5}명` : head;
    };
    start(async () => {
      const res = await linkIjwUniqueMatches({ pairs });
      setBulkOpen(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const tail = [
        res.dropped.length
          ? `${res.dropped.length}명은 그사이 짝 후보가 바뀌어 빼 두었습니다 — ${names(res.dropped)}(목록에서 직접 골라 주세요)`
          : "",
        res.skipped.length ? `${res.skipped.length}명은 그사이 연결돼 건너뜀 — ${names(res.skipped)}` : "",
        res.failed ? `${res.failed}명은 저장하지 못함 — 다시 눌러 주세요` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const text = `${res.linked}명을 연결했습니다${tail ? ` (${tail})` : ""}`;
      if (res.failed || res.dropped.length) toast.warning(text);
      else toast.success(text);
      router.refresh();
    });
  }

  return (
    <section className="border-amber/40 bg-amber-soft/40 space-y-2 rounded-2xl border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-sm font-bold">
          인재원 학생 중 에이와 학생과 아직 연결되지 않은 <span className="num">{rows.length}</span>명
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {uniqueRows.length > 0 ? (
            <Button
              size="sm"
              variant={bulkOpen ? "outline" : "default"}
              disabled={pending}
              onClick={() => setBulkOpen((v) => !v)}
              title="이름이 양쪽 모두(퇴원생 포함) 하나뿐인 학생만 — 누르면 이을 짝을 먼저 보여 줍니다"
            >
              {bulkOpen ? "한 번에 연결 닫기" : `이름이 하나뿐인 ${uniqueRows.length}명 한 번에 연결…`}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "목록 접기" : "목록 보기"}
          </Button>
        </div>
      </div>
      {bulkOpen ? (
        <div className="border-amber/60 bg-card space-y-2 rounded-lg border px-3 py-2">
          <p className="text-text-dim text-xs">
            아래 목록에 있는 짝만 잇습니다. 누르는 순간 서버가 다시 확인해, 그사이 바뀐 짝은 빼고 누구인지 알려 드립니다.
          </p>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto px-1 text-sm">
            {uniqueRows.map((r) => (
              <li key={r.ijwId}>
                <span className="text-foreground font-bold">{ijwSideLabel(r)}</span>
                <span className="text-text-faint"> ↔ </span>
                <span className="text-foreground">{r.uniqueLabel}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={pending} onClick={linkAllUnique}>
              {uniqueRows.length}명 연결
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setBulkOpen(false)}>
              취소
            </Button>
          </div>
        </div>
      ) : null}
      <p className="text-text-dim text-xs">
        이름만으로 자동 연결하지 않습니다(인재원엔 생년월일·학교가 없어 동명이인을 가를 수 없습니다). 인재원 이름이
        로그인 아이디인 학생은 아이디 머리글자(예: ijwhgd → 홍길동)로 후보를 찾아 드립니다 — 머리글자는 겹칠 수 있으니
        후보를 고른 뒤 확인 줄에서 반·학교를 보고 [연결]을 눌러 주세요.
      </p>
      {open ? (
        <ul className="divide-line divide-y">
          {rows.map((r) => (
            <JjLinkRowItem
              key={r.ijwId}
              row={r}
              poolOptions={poolOptions}
              pending={pending}
              onLink={(id, label, done) => linkOne(r, id, label, done)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
