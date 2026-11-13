"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { netDateText } from "@/features/explore/components/network/time-tree";
import type { NetNeighbor } from "@/features/explore/components/network/types";
import { entities } from "./catalog";
import type { Node } from "./graph";
import type { AcademyKnowledgeData } from "./server";
import { liveHref } from "./routes";
import { kgDetailParam } from "./kg-net";
import { nodeHealth, type Gap } from "./studio-model";
import s from "./studio.module.css";

const labels: Record<string, string> = Object.fromEntries(entities);

/** 고른 날짜 묶음(연도·월·일자) — 이름 · 영역 · 기록 수 · 그 아래 든 것(최근 먼저). */
export type InspectorGroup = { title: string; hub: string; tally: number; items: NetNeighbor[] };

type Props = {
  data: AcademyKnowledgeData;
  /** 고른 기록(지식그래프 점) — 없으면 묶음 또는 '지도 읽는 법'. */
  focus: Node | undefined;
  group: InspectorGroup | null;
  gaps: Gap[];
  gapKey: string | null;
  onGap: (key: string) => void;
  /** 목록 줄을 고른다(판도 그 점을 강조한다). */
  onPick: (id: string) => void;
  /** 학생·강사 상세 자료 불러오기 직전 — 판을 맡겨 새 판이 이어서 움직이게. */
  onLeave: (id: string) => void;
  onAddLink: () => void;
  isolated: number;
};

/**
 * 지식그래프 오른쪽 칸 — 고른 기록의 내용 · 연결 항목 점검 · 참고 관계 추가 · 기록 설명(종전 그대로), 날짜 묶음이면 그 아래 기록 목록,
 * 아무것도 고르지 않았으면 '지도 읽는 법'. 판은 연결 탐색 네트워크(graph-tab.tsx).
 */
export function GraphInspector({ data, focus, group, gaps, gapKey, onGap, onPick, onLeave, onAddLink, isolated }: Props) {
  const tenant = data.graph.tenant;
  const detailHref = (q: { student: string } | { teacher: string }) => `/dashboard/management/knowledge?${new URLSearchParams({ month: data.month, tab: "graph", ...q }).toString()}`;
  const chosenGap = gaps.find((g) => g.key === gapKey);
  if (group)
    return (
      <aside className={s.inspector}>
        <span className={s.pill}>{group.hub}</span>
        <h3>{group.title}</h3>
        <p>
          기록 {group.tally.toLocaleString()}건 · 판에서 이 묶음을 더블클릭하면 펼치고 접습니다.
        </p>
        <div className={s.list}>
          {group.items.map((it) => (
            <button key={it.id} onClick={() => onPick(it.id)}>
              <strong>{it.title}</strong>
              <small>{it.unit ? `${it.unit} 묶음` : [netDateText(it.date), it.rel].filter(Boolean).join(" · ") || group.hub}</small>
            </button>
          ))}
        </div>
      </aside>
    );
  if (!focus) {
    const pending = data.studio.rows.filter((r) => r.document.kind === "link" && r.document.state === "pending").length;
    return (
      <aside className={s.inspector}>
        <h3>지도 읽는 법</h3>
        <p>개별 기록: 점 하나가 원기록 하나 · 큰 점은 주체(학생·반·강사…) · 날짜가 있는 기록은 연도 → 월 → 일자로 묶입니다(묶음 더블클릭 = 펼치기·접기)</p>
        <p>주체별 요약: 주체를 기록 수만큼 큰 점으로 · 주체 사이 선이 굵을수록 실제 관계가 많습니다</p>
        <p>선: 중심 → 주체 → 묶음 → 기록으로 잇는 뼈대 + 가운데 기록의 실제 관계 · 다른 두 기록 사이의 관계선은 그 점에 마우스를 올리거나 점을 고르면 나타납니다</p>
        <p>묶기(도구줄): 학년·과목·연도 묶음(묶음 밖 기록은 주체 점) 사이 관계를 휘어진 한 줄로 · 굵을수록 관계가 많습니다 · 기록을 고르면 그 기록이 든 묶음의 선이 진해집니다 · 묶음을 접으면 위 묶음으로 합쳐집니다</p>
        <p>더블클릭: 그 기록이 중심(학생·강사는 상세 자료를 불러옵니다) · 우클릭: 이전 중심으로</p>
        <p>학원 전체가 중심이면 조회된 모든 기록을, 기록이 중심이면 바로 이어진 기록과 한 단계 더 이어진 기록(중심과 같은 유형 제외)을 보여 줍니다</p>
        <p>다른 기록과 관계가 없는 기록 {isolated.toLocaleString()}개 · 미입력 확정이 아닙니다</p>
        <div className={s.callout}>
          확인 대기 {pending}건<br />
          미반영 관계 {data.graph.issues.reduce((n, i) => n + i.count, 0)}건
        </div>
        <p>배치는 읽기 위한 자리입니다. 가까이 있다는 이유로 업무 관계를 추가하지 않습니다.</p>
      </aside>
    );
  }
  const health = nodeHealth(focus);
  // 주소로 불러올 수 있는 사람만(목록 밖·권한 밖이면 서버가 거절해 화면이 열리지 않는다) · 이미 주소의 사람이면 없음.
  const here = focus.id === `${tenant}:student:${data.selectedStudent}` || focus.id === `${tenant}:staff:${data.selectedTeacher}`;
  const detail = here ? null : kgDetailParam(focus, tenant, data.students, data.staff);
  return (
    <aside className={s.inspector}>
      <span className={s.pill}>{labels[focus.type]}</span>
      <h3>{focus.label}</h3>
      {health && <span className={s.orange}>{health}</span>}
      {/* 출처 글의 영문 표·열 이름(students · factors)은 화면에 내지 않는다 */}
      <p>{focus.source.split(" · ").filter((part) => !/^[\x00-\x7F]+$/.test(part)).join(" · ")}</p>
      {focus.period && <small>{focus.period}</small>}
      {focus.href && (
        <Link className={s.button} href={focus.href}>
          {focus.type === "Student" ? "이 학생의 관찰·조치 보기 ↗" : "실제 기록·값 수정 ↗"}
        </Link>
      )}
      {detail && (
        <Link className={s.button} href={detailHref(detail)} scroll={false} onClick={() => onLeave(focus.id)}>
          {"student" in detail ? "학생 상세 자료 불러오기" : "강사 상세 자료 불러오기"}
        </Link>
      )}
      <h4>연결 항목 점검</h4>
      <p className={s.note}>직접 연결과 관찰·수강을 통한 2단계 연결을 확인합니다. 미측정·부분 자료·분석 정의만 있는 항목은 충족으로 세지 않습니다. 업무 완료율과는 다릅니다.</p>
      {gaps.map((g) => (
        <button className={s.gap} key={g.key} onClick={() => onGap(g.key)}>
          <span>{g.label}</span>
          <strong className={g.state === "connected" ? s.green : g.state === "unloaded" ? s.pill : s.orange}>
            {g.state === "connected" ? `${g.actual}개 연결` : g.state === "unloaded" ? "상세 조회 필요" : "연결 확인 필요"}
          </strong>
        </button>
      ))}
      {!gaps.length && <p>등록된 점검 기준이 없습니다. 보완 점검 탭에서 추가할 수 있습니다.</p>}
      {chosenGap && (
        <div className={s.callout}>
          <strong>{chosenGap.label}</strong>
          <p>
            확인된 연결 {chosenGap.actual}개 / 점검 기준 {chosenGap.minimum}개.{" "}
            {chosenGap.state === "unloaded" ? "상세 자료를 불러온 후 판단해 주세요." : "관계가 없거나 이 조회 범위에 포함되지 않았을 수 있습니다."}
          </p>
          {liveHref(chosenGap.href) && <Link href={liveHref(chosenGap.href)!}>입력·연결 확인하러 가기 →</Link>}
        </div>
      )}
      <button disabled={!data.studio.canWrite} onClick={onAddLink}>
        근거를 남기고 참고 관계 추가
      </button>
      {focus.detail && (
        <details>
          <summary>기록 설명</summary>
          <p className={s.break}>{focus.detail}</p>
        </details>
      )}
    </aside>
  );
}
