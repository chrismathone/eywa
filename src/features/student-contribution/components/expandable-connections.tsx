"use client";
import { useId, useRef, useState } from "react";
import type { LiveSection } from "@/features/students/ontology/live-contract";
import { Button } from "@/components/ui/button";
import { LiveSectionView } from "./live-section-view";

type Props = { studentId: string; title: string; description: string; columns?: 2 | 3;
  loadAction: (studentId: string) => Promise<{ error?: string; sections?: LiveSection[] }> };

export function ExpandableConnections({ studentId, title, description, columns = 3, loadAction }: Props) {
  const panelId = useId();
  const [sections, setSections] = useState<LiveSection[] | null>(null), [open, setOpen] = useState(false);
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true);
    setError("");
    try {
      const result = await loadAction(studentId);
      if (result.error) { setSections(null); setError(result.error); }
      else { setSections(result.sections ?? []); setOpen(true); }
    } catch { setSections(null); setError("기록을 불러오지 못했습니다. 다시 시도해 주세요."); }
    finally { inFlight.current = false; setPending(false); }
  };
  const failed = sections?.some((s) => s.state === "failed" || s.state === "schema_missing");
  return <section className="space-y-3 rounded-xl border border-line p-4" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs">{description}</p></div>
      <div className="flex gap-2">
        {open && failed && <Button size="sm" variant="outline" onClick={load} disabled={pending}>다시 불러오기</Button>}
        <Button size="sm" variant="outline" onClick={() => sections ? setOpen(!open) : load()} disabled={pending} aria-expanded={open} aria-controls={panelId}>
          {pending ? "불러오는 중…" : open ? "접기" : error ? "다시 시도" : "기록 펼치기"}
        </Button>
      </div></div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div id={panelId} hidden={!open} aria-busy={pending}>
      {open && sections && <div className={`grid grid-cols-1 items-start gap-4 md:grid-cols-2 ${columns === 3 ? "lg:grid-cols-3" : ""}`}>
        {columns === 2 ? [0, 1].map((column) => <div key={column} className="min-w-0 space-y-4">
          {sections.filter((_, i) => i % 2 === column).map((section) => <LiveSectionView key={section.key} section={section} />)}
        </div>) : sections.map((section) => <LiveSectionView key={section.key} section={section} />)}
      </div>}
    </div>
  </section>;
}
