"use client";

import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { isExploreKind, zoomPlan, type ExploreTarget } from "@/features/explore/model";
import { ExploreNetwork, prepareNetworkLeave, type NetRecordInfo } from "@/features/explore/components/network/explore-network";
import { CENTERS } from "@/features/explore/components/network/testing/fixture";

/**
 * 개발 전용 — 로그인 없이 네트워크 보기를 가상 값으로 띄워 중심 전환 보간·역재생·보기 전환을 눈으로 확인한다.
 * 실제 화면처럼 중심이 바뀌면 판을 **새로 마운트**한다(`key`) — 떠나기 직전 `prepareNetworkLeave`, 서버 대기를 흉내 낸 지연 뒤 새 중심.
 */
const parse = (key: string) => {
  const [kind, id, ...rest] = key.split(":");
  return isExploreKind(kind) ? { kind, id, ...(rest.length ? { sector: rest.join(":") } : {}) } : null;
};

export function Harness() {
  const [center, setCenter] = useState("student:s1");
  const [trail, setTrail] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [record, setRecord] = useState<NetRecordInfo | null>(null);
  const [view, setView] = useState<"records" | "summary">("records");
  const [wide, setWide] = useState(false);
  const [instant, setInstant] = useState(false);
  const [colored, setColored] = useState(false);
  const [labels, setLabels] = useState(false);
  const [latency, setLatency] = useState(120);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 10));
  const input = CENTERS[center];

  /** 중심 바꾸기 — 실제 화면의 `router.push` + 새 마운트를 흉내(지연 = 서버 시간). */
  const go = (to: string, dir: "in" | "out", pivotId: string | null, nextTrail: string[]) => {
    const next = parse(to);
    if (!next || !CENTERS[to]) return toast("이 대상의 중심은 시험 표본에 없습니다.");
    const hold = prepareNetworkLeave(next, { dir, pivotId });
    note(`${dir === "in" ? "들어감" : "되돌아감"} → ${to} (축 ${pivotId ?? "자동"} · 붙듦 ${hold}ms)`);
    window.setTimeout(() => {
      setTrail(nextTrail);
      setCenter(to);
      setSelected(null);
      setRecord(null);
    }, Math.max(hold, instant ? 0 : latency));
  };
  const openTarget = (t: ExploreTarget, via: string) => go(`${t.kind}:${t.id}`, "in", via, [...trail, center]);
  const zoomSector = (sel: string) => {
    const plan = zoomPlan(input.model, sel, [], false);
    if (!plan || !("go" in plan)) return note(`흡수: 링크 열기(${sel})`);
    const to = plan.to.sector ? `${plan.to.kind}:${plan.to.id}:${plan.to.sector}` : `${plan.to.kind}:${plan.to.id}`;
    go(to, "in", null, [...trail, center]);
  };
  const back = (i = trail.length - 1) => {
    if (i < 0) return toast("되돌아갈 이전 중심이 없습니다.");
    go(trail[i], "out", null, trail.slice(0, i));
  };

  const cols = wide ? "grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-[280px_minmax(0,1fr)_380px]";
  return (
    <main className="space-y-2 p-4">
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="탐색 경로" data-harness-trail="">
        {trail.map((t, i) => (
          <button key={t} type="button" data-trail={i} className="text-primary underline" onClick={() => back(i)}>
            {CENTERS[t]?.model.center.name ?? t}
          </button>
        ))}
        <b data-here="">{input.model.center.name}</b>
        <span className="ml-auto flex items-center gap-3">
          <label>
            <input type="checkbox" checked={instant} onChange={(e) => setInstant(e.target.checked)} data-instant="" /> 전환 효과 생략
          </label>
          <label>
            지연
            <select value={latency} onChange={(e) => setLatency(Number(e.target.value))} className="ml-1 border">
              {[0, 120, 600].map((v) => (
                <option key={v} value={v}>
                  {v}ms
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="border px-2" onClick={() => go("class:c1", "in", null, [...trail, center])} data-go-class="">
            중2 수학 A반으로(패널 길)
          </button>
        </span>
      </nav>
      <div className={`grid gap-4 transition-[grid-template-columns] duration-400 ${cols}`} style={{ "--net-h": "calc(100dvh - 7rem)" } as CSSProperties}>
        {wide ? null : <aside className="bg-bg-soft rounded-xl p-3 text-sm">왼쪽 열 자리</aside>}
        <ExploreNetwork
          key={center}
          {...input}
          selected={selected}
          record={record?.id ?? null}
          onSelectSector={(k) => setSelected(k)}
          onSelectRecord={(r) => setRecord(r)}
          onZoomSector={zoomSector}
          onOpenTarget={openTarget}
          onOpenRecord={(r) => note(`자세히: ${r.kind} · ${r.title}`)}
          onCenterZoom={() => note(`상세 열기: ${input.model.center.detailLabel}`)}
          onBack={() => back()}
          view={view}
          onViewChange={setView}
          wide={wide}
          onWideChange={setWide}
          instant={instant}
          colored={colored}
          labels={labels}
          onColoredChange={setColored}
          onLabelsChange={setLabels}
        />
        <section className="space-y-2 text-sm" data-harness-panel="">
          <p>
            고른 영역 <b data-sel="">{selected ?? "—"}</b>
          </p>
          <p>
            고른 기록 <b data-rec="">{record ? `${record.kind} · ${record.title}` : "—"}</b>
          </p>
          {record?.detail ? <p>{record.detail}</p> : null}
          <ol className="space-y-1" data-log="">
            {log.map((l, i) => (
              <li key={`${i}-${l}`}>{l}</li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
