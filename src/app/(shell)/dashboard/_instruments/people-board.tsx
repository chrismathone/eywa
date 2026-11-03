"use client";

import { studentsOf, type PersonLoad } from "@/features/dashboard/instruments/secretary-facts";
import { GoIcon } from "./parts";

const cell = (n: number, unit: string) => (n ? `${n.toLocaleString("ko-KR")}${unit}` : "—");

/**
 * 확인할 일 '사람별' — 같은 값을 사람마다 묶는다(담임으로 붙은 학생 · 기한 지난 할 일 · 맡은 업무 요청). 줄을 누르면 그 사람의
 * 학생 명단이 열리고, '요청'은 그 사람에게 그 사람 학생만 한 번에 맡긴다. 할 일만 있는 사람은 할 일 창(그 사람으로 거름)으로.
 */
export function PeopleBoard({ people, canRequest, onRequest, onTasks }: {
  people: readonly PersonLoad[]; canRequest: boolean; onRequest: (p: PersonLoad) => void; onTasks: (id: string) => void;
}) {
  if (!people.length) return <p className="foot">사람에게 몰린 확인할 일이 없습니다.</p>;
  return (
    <table className="people-table">
      <thead>
        <tr>
          <th scope="col">담당</th>
          <th scope="col" className="is-num">반복 결석</th>
          <th scope="col" className="is-num">숙제 60% 미만</th>
          <th scope="col" className="is-num">지난달부터 상담 없음</th>
          <th scope="col" className="is-num">기한 지난 할 일</th>
          <th scope="col" className="is-num">맡은 업무 요청</th>
          <th scope="col" aria-label="처리" />
        </tr>
      </thead>
      <tbody>
        {people.map((p) => {
          const students = studentsOf(p).length;
          return (
            <tr key={p.id} data-detail={`person:${p.id}`}>
              <th scope="row"><button type="button" className="card-open">{p.name || "이름 없는 직원"}</button></th>
              <td className={`is-num${p.absence.length ? " strong" : " is-zero"}`}>{cell(p.absence.length, "명")}</td>
              <td className={`is-num${p.homework.length ? "" : " is-zero"}`}>{cell(p.homework.length, "명")}</td>
              <td className={`is-num${p.consult.length ? "" : " is-zero"}`}>{cell(p.consult.length, "명")}</td>
              <td className={`is-num${p.lateTasks ? "" : " is-zero"}`}>{cell(p.lateTasks, "건")}</td>
              <td className={`is-num${p.work.open ? "" : " is-zero"}`}>{p.work.open ? `${cell(p.work.open, "건")}${p.work.late ? ` · 지남 ${p.work.late}` : ""}` : "—"}</td>
              <td className="go-cell">
                {students && canRequest ? <button type="button" className="check-request" data-noopen onClick={() => onRequest(p)}>요청</button>
                  : p.lateTasks ? <button type="button" className="check-request is-quiet" data-noopen onClick={() => onTasks(p.id)}>할 일</button>
                  : <GoIcon />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
