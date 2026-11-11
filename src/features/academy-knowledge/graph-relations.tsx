"use client";
import { relationLabel } from "./kg-net";
import type { AcademyKnowledgeData } from "./server";
import type { StudioRow } from "./studio-model";
import s from "./studio.module.css";

type Edge = AcademyKnowledgeData["graph"]["edges"][number];

/**
 * 지식그래프 판 아래 — 고른 기록의 실제 관계와 근거(최대 200건) · 직접 연결한 관계와 확인·수정 이력(종전 그대로).
 * 관계 표의 대상을 누르면 그 기록을 고른다(판에 없으면 그 기록이 가운데 — graph-tab.tsx `pick`).
 */
export function GraphRelations({ data, selected, links, onPick, onEditLink }: { data: AcademyKnowledgeData; selected: string; links: Edge[]; onPick: (id: string) => void; onEditLink: (row: StudioRow) => void }) {
  const linkRows = data.studio.rows.filter((r) => r.document.kind === "link");
  return (
    <>
      {selected && (
        <details className={s.history}>
          <summary>실제 관계와 근거 {links.length}개</summary>
          <div className={s.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>대상</th>
                  <th>관계</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {links.slice(0, 200).map((e, i) => {
                  const other = e.from === selected ? e.to : e.from;
                  return (
                    <tr key={i}>
                      <td>
                        <button onClick={() => onPick(other)}>{data.graph.nodes.find((n) => n.id === other)?.label}</button>
                      </td>
                      <td>{relationLabel(e)}</td>
                      <td>{e.basis}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {links.length > 200 && <p>200건 표시 · 전체는 JSON 내보내기에서 확인</p>}
        </details>
      )}
      <details className={s.history}>
        <summary>직접 연결한 관계 · 확인·수정 이력 {linkRows.length}건</summary>
        {linkRows.map((r) => (
          <article className={s.record} key={r.key}>
            <strong>{r.document.label}</strong>
            {r.document.kind === "link" && (
              <p>
                {r.document.state === "pending" ? "확인 대기" : r.document.state === "retired" ? "사용 중지" : "확인 완료"} · {r.document.basis}
              </p>
            )}
            <small>
              v{r.version} · {new Date(r.recorded_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
            </small>
            <button disabled={!data.studio.canWrite} onClick={() => onEditLink(r)}>
              관계 확인·수정
            </button>
            <details>
              <summary>이전 버전</summary>
              {data.studio.history
                .filter((h) => h.key === r.key)
                .map((h) => (
                  <p key={h.version}>
                    v{h.version} · {h.document.kind === "link" ? h.document.state : ""} · {h.document.kind === "link" ? h.document.basis : ""} · {data.staff.find((p) => p.id === h.actor_id)?.display_name ?? "기록 담당자"}
                  </p>
                ))}
            </details>
          </article>
        ))}
      </details>
    </>
  );
}
