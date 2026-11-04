"use client";

import { useState } from "react";
import type { WorkPerson } from "@/features/work-requests/model";
import { bodyFor, lacksOwnPart, recipientNames, splitsByRecipient, twinHeadings } from "@/features/work-requests/recipient-body";
import "./recipient.css";

/**
 * 받는 글 미리보기 — 선생님마다 자기 몫만 받는다(원장 2026-11-03 *"각 선생님에게 각자 학생것만 가면 되지 않을까?"*).
 * 고른 선생님이 받는 글을 그대로 그린다 — 서버가 담당자에게 내려줄 때와 같은 함수(`bodyFor` · 제목 이름 `recipientNames`).
 * 몫을 가를 제목이 없으면 모두 같은 글이라 띄우지 않는다. `owns` = 그 사람이 맡은 근거 학생이 있나 — 있는데 제 이름 제목이 없으면 알린다
 * (그 선생님은 모두에게 가는 글만 받는다).
 */
export function RecipientPreview({ body, people, owns }: { body: string; people: readonly WorkPerson[]; owns: (id: string) => boolean }) {
  const [pick, setPick] = useState("");
  const byId = recipientNames(people);
  const names = [...byId.values()];
  if (!people.length || !splitsByRecipient(body, names)) return null;
  const person = people.find((p) => p.id === pick) ?? null;
  const missing = people.filter((p) => owns(p.id) && lacksOwnPart(body, byId.get(p.id) ?? "", names)).map((p) => byId.get(p.id) ?? p.name);
  const twins = twinHeadings(body, names);
  return (
    <div className="work-recipient">
      <p className="work-hint">선생님마다 자기 이름 제목(○○ 선생님) 아래 글만 받고, 그 밖의 글은 모두 받습니다 · ‘담당 미정’ 아래는 아무에게도 가지 않습니다</p>
      <div className="work-recipient-pick">
        <span>받는 글 미리보기</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="받는 글을 볼 선생님">
          <option value="">선생님 고르기</option>
          {people.map((p) => <option key={p.id} value={p.id}>{byId.get(p.id) ?? p.name}</option>)}
        </select>
      </div>
      {twins.length ? <p className="work-hint">이름이 같은 선생님이 있어 이름만 적은 제목 아래 글은 그 이름의 선생님 모두({twins.join(" / ")})에게 갑니다 — 한 분에게만 보내려면 제목을 ‘이름(과목) 선생님’으로 적어 주세요.</p> : null}
      {missing.length ? <p className="work-error" role="status">{missing.join(" · ")} 선생님 이름 제목이 없어 맡은 학생 내용이 가지 않습니다 — 제목을 ‘{missing[0]} 선생님’처럼 맞춰 주세요.</p> : null}
      {person ? <div className="work-body rich-content work-recipient-body" dangerouslySetInnerHTML={{ __html: bodyFor(body, byId.get(person.id) ?? person.name, names) }} /> : null}
    </div>
  );
}
