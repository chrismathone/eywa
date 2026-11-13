"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { useGradeLevels, useSubjectMaps } from "@/features/owner/operations-context";
import { ExploreNetwork, netNeighbors, prepareNetworkLeave, type NetRecordInfo } from "@/features/explore/components/network/explore-network";
import { entities } from "./catalog";
import { GraphDirectory } from "./graph-directory";
import { GraphInspector } from "./graph-inspector";
import { GraphRelations } from "./graph-relations";
import type { KgGraphPrefs } from "./graph-prefs";
import { academyNodeId, isolatedCount, kgDetailParam, kgNetBoard } from "./kg-net";
import type { AcademyKnowledgeData } from "./server";
import { LinkEditor, StoreNotice } from "./studio";
import { expectations, nodeGaps, uniqueEdges, type StudioRow } from "./studio-model";
import s from "./studio.module.css";
import { useGraphView } from "./use-graph-view";

const labels: Record<string, string> = Object.fromEntries(entities);

/**
 * 지식그래프 탭 — 판은 연결 탐색 네트워크(`ExploreNetwork` · 개별 기록 | 주체별 요약 · 묶음 · 보간)를 그대로 쓰고, 점·선은 `kg-net.ts`가 짠다.
 * 한 번 클릭 = 고르기(오른쪽 칸) · 두 번 = 그 기록이 중심(학생·강사는 주소 이동으로 상세 자료를 불러온다 · 그 밖은 화면 안에서) ·
 * 우클릭 = 이전 중심(화면 안 기록이 없고 주소로 학생·강사를 골랐으면 학원 전체 주소로). 보기·색상·이름 표시 = 계정 귀속(`ui_prefs.knowledgeGraph`).
 */
export function GraphTab({ data, prefs }: { data: AcademyKnowledgeData; prefs: KgGraphPrefs }) {
  const router = useRouter();
  const embed = useEmbed();
  const [, startTransition] = useTransition();
  const tenant = data.graph.tenant;
  const academy = academyNodeId(tenant);
  const urlCenter = data.selectedStudent ? `${tenant}:student:${data.selectedStudent}` : data.selectedTeacher ? `${tenant}:staff:${data.selectedTeacher}` : "";
  const byId = useMemo(() => new Map(data.graph.nodes.map((n) => [n.id, n])), [data.graph]);
  const net = useGraphView(prefs);
  const [center, setCenter] = useState(urlCenter || academy);
  const [stack, setStack] = useState<string[]>([]);
  const [selected, setSelected] = useState(urlCenter);
  const [sector, setSector] = useState<string | null>(null);
  const [type, setType] = useState<string>(data.selectedTeacher ? "Staff" : "Student");
  const [search, setSearch] = useState("");
  const [gapKey, setGapKey] = useState<string | null>(null);
  const [editor, setEditor] = useState(false);
  const [chosenLink, setChosenLink] = useState<StudioRow | undefined>();
  const [linkFrom, setLinkFrom] = useState(""); // 편집기를 연 순간의 기록 — 그 뒤 판에서 묶음·영역을 골라도 편집기는 그대로
  const subjects = useSubjectMaps();
  const gradeOrder = useGradeLevels();
  // 분류 묶음의 과목·학년 이름과 순서 = 학원 설정(kg-net-groups.ts)
  const cats = useMemo(() => ({ subjectLabel: subjects.labelOf, subjectOrder: subjects.options.map((o) => o.value), gradeOrder }), [subjects, gradeOrder]);
  const board = useMemo(() => kgNetBoard(data.graph, center, cats, net.bundle), [data.graph, center, cats, net.bundle]);
  const here = board.center.id;
  const onBoard = useMemo(() => new Set(board.graph.nodes.map((n) => n.id)), [board]);
  const isolated = useMemo(() => isolatedCount(data.graph), [data.graph]);
  const rules = useMemo(() => expectations(data.studio.rows), [data.studio.rows]);
  const focus = byId.get(selected);
  const gaps = useMemo(
    () => (focus ? nodeGaps(data.graph, focus, rules, data.status.some((x) => x.name === "학생 통합" && x.state === "연결") ? data.selectedStudent : "", data.selectedTeacher) : []),
    [data.graph, focus, rules, data.selectedStudent, data.selectedTeacher, data.status],
  );
  const groupNode = !focus && selected.startsWith("grp:") ? board.graph.nodes.find((n) => n.id === selected && n.kind === "group") : undefined;
  const group = groupNode ? { title: groupNode.title, hub: labels[groupNode.sectorKey ?? ""] ?? "기록", tally: groupNode.tally ?? 0, items: netNeighbors(board, groupNode.id) } : null;
  const links = uniqueEdges(data.graph).filter((e) => e.from === selected || e.to === selected);

  const hrefFor = (q: { student?: string; teacher?: string }) => {
    const href = `/dashboard/management/knowledge?${new URLSearchParams({ month: data.month, tab: "graph", ...q }).toString()}`;
    return embed ? withEmbed(href) : href;
  };
  const leave = (to: string, dir: "in" | "out", pivotId: string | null) => prepareNetworkLeave({ centerId: to }, { dir, pivotId });
  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const moveTo = (id: string, push: boolean) => {
    if (push) setStack((st) => [...st, here]);
    setCenter(id);
    setSelected(id === academy ? "" : id);
    setSector(null);
    setGapKey(null);
  };
  /** 그 기록이 중심 — 상세를 불러올 학생·강사(지금 주소의 사람이 아니면)는 주소 이동, 그 밖은 화면 안에서. */
  const recenter = (id: string) => {
    const n = byId.get(id);
    if (!n || id === here) return;
    if (n.type === "Academy") return toAcademy();
    const detail = id !== urlCenter ? kgDetailParam(n, tenant, data.students, data.staff) : null;
    leave(id, "in", onBoard.has(id) ? id : null);
    if (detail) return go(hrefFor(detail));
    moveTo(id, true);
  };
  const toAcademy = () => {
    if (here !== academy) leave(academy, "out", null);
    setStack([]);
    moveTo(academy, false);
  };
  const back = () => {
    const prev = stack[stack.length - 1];
    if (prev) {
      leave(prev, "out", null);
      setStack(stack.slice(0, -1));
      return moveTo(prev, false);
    }
    if (urlCenter && here !== academy) {
      leave(academy, "out", null);
      return go(hrefFor({}));
    }
    toast("되돌아갈 이전 중심이 없습니다.");
  };
  /** 목록·관계 표에서 고르기 — 판에 있으면 고르고, 없으면 그 기록이 가운데(주소는 그대로). */
  const pick = (id: string) => {
    setGapKey(null);
    const n = byId.get(id);
    if (onBoard.has(id)) {
      setSelected(id);
      if (n) setType(n.type);
      return;
    }
    if (!n) return;
    if (n.type === "Academy") return toAcademy();
    leave(id, "in", null);
    moveTo(id, true);
    setType(n.type);
  };
  const selectRecord = (rec: NetRecordInfo | null) => {
    setGapKey(null);
    setSelected(rec?.id ?? "");
    const n = rec ? byId.get(rec.id) : undefined;
    if (n) setType(n.type);
  };
  const selectSector = (key: string | null) => {
    setSector(key);
    if (key) setType(key);
  };

  return (
    <section className={s.studio}>
      <StoreNotice data={data} />
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>지식 네트워크</p>
          <h2>기록이 모이고, 관계가 보이는 학원</h2>
          <p>작은 점 하나가 실제 기록입니다. 주체(학생·반·강사…)별로 모이고, 점을 고르면 이름과 근거가 드러납니다. 두 번 누르면 그 기록이 중심이 됩니다.</p>
        </div>
        <button className={s.button} onClick={toAcademy}>
          전체 기록으로
        </button>
      </div>
      <div className={s.graphLayout} data-wide={net.wide ? "true" : undefined}>
        <GraphDirectory nodes={data.graph.nodes} type={type} search={search} selected={selected} onType={setType} onSearch={setSearch} onPick={pick} />
        <div className={s.netHost}>
          <ExploreNetwork
            key={here}
            graph={board.graph}
            center={board.center}
            selected={sector}
            record={selected && selected !== here ? selected : null}
            onSelectSector={selectSector}
            onSelectRecord={selectRecord}
            onZoomSector={selectSector}
            onOpenTarget={() => undefined}
            onOpenRecord={(rec) => recenter(rec.id)}
            onCenterZoom={() => setSelected(here)}
            onBack={back}
            instant={false}
            {...net}
          />
          <p className={s.note}>
            {board.academy
              ? `조회된 기록 ${board.total.toLocaleString()}개 전부 · 가운데 = 학원 전체`
              : `판에 ${board.shown.toLocaleString()}개 기록 · 조회된 ${board.total.toLocaleString()}개 중 중심과 바로 이어진 기록과 한 단계 더 이어진 기록(중심과 같은 유형 제외)`}
            . 기록 사이 관계선은 그 점에 마우스를 올리거나 점을 고르면 나타납니다(가운데 기록의 관계선은 늘 보입니다) · 위 &apos;묶기&apos;를 켜면 묶음 사이 관계가 한 줄로 모여 보입니다(굵을수록 많음). 선은 확인된 기록 관계이며, 배치·점 크기는 평가 점수나 인과관계가 아닙니다. 조회된 자료 범위만 표시하며, 연결 없음은 미입력 확정이 아닙니다.
          </p>
        </div>
        <GraphInspector
          data={data}
          focus={focus}
          group={group}
          gaps={gaps}
          gapKey={gapKey}
          onGap={setGapKey}
          onPick={pick}
          onLeave={(id) => leave(id, "in", onBoard.has(id) ? id : null)}
          onAddLink={() => {
            setLinkFrom(focus?.id ?? "");
            setChosenLink(undefined);
            setEditor(true);
          }}
          isolated={isolated}
        />
      </div>
      {editor && <LinkEditor key={chosenLink ? `${chosenLink.key}:${chosenLink.version}` : `new:${linkFrom}`} data={data} from={linkFrom} row={chosenLink} onClose={() => setEditor(false)} />}
      <GraphRelations
        data={data}
        selected={focus ? selected : ""}
        links={links}
        onPick={pick}
        onEditLink={(r) => {
          setChosenLink(r);
          setEditor(true);
        }}
      />
    </section>
  );
}
