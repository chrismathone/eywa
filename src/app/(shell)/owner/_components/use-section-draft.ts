"use client";

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { stableStringify } from "@/lib/stable-json";
import { isOlderRev } from "@/features/owner/settings-stamp";

/**
 * 설정 폼의 **작성 중 값(draft) · 확정 스냅샷 · 기준 token**을 한 묶음으로 다룬다(운영 체계 · 과목 운영 · 역할·권한).
 *
 * 🔴 셋은 **함께만** 움직인다 — token은 "이 draft가 서버의 어느 상태에서 출발했나"의 표식이다.
 *    token만 새것으로 갈아끼우면 옛 draft가 저장 검사를 통과해 그사이 다른 창이 한 저장을 되돌린다.
 *  · 서버가 새 값을 내려보내면(다른 창의 저장 뒤 새로고침 등) **draft가 깨끗할 때만** 셋을 함께 바꾼다.
 *    수정 중이면 셋 다 그대로 둔다 → 그사이 같은 면이 바뀌었으면 저장이 거절된다(덮지 않는다).
 *  · 저장 성공은 **제출한 값**에 대해 확정한다(`noteSubmitted` → `confirmSaved`) — 저장 도중 더 고친 것은 계속 '미저장'이다.
 *  · 🔴 **저장이 도는 동안에는 서버 값을 받지 않고 미뤄 둔다** — 응답(성공·실패)을 먼저 반영한 뒤에 본다.
 *    새 값이 응답보다 먼저 도착하는 순서가 있고, 그때 바로 받으면 뒤늦은 응답과 어느 쪽이 새것인지 가릴 수 없다.
 *  · 🔴 **내 확정 상태보다 먼저 읽힌 값은 받지 않는다**(`version` = 그 값을 읽은 문서의 저장 순번).
 *    화면에 내려오는 값은 "도착한 순서"가 "읽힌 순서"와 다를 수 있다 — 내 저장이 반영되기 전에 읽힌 값이
 *    저장 뒤에 도착하면, 방금 저장한 내용이 화면에서 사라지고 기준 token도 옛것으로 돌아간다.
 *    순번은 문서 안의 숫자라 시계와 무관하고, 순번을 모르는 쓰기는 그대로 둘 뿐 줄이지 않는다(`settings-stamp.ts`).
 *    행이 아직 없던 읽기는 0이라 첫 저장(1)보다 앞선다. 순번을 모르면(읽기 전용 등) 평소 규칙대로 다룬다.
 *  · 서버가 확정 상태를 직접 돌려준 경우(과목 삭제)는 `adopt`로 셋을 통째로 받는다.
 * ⚠️ `adopt`와 제출은 겹치지 않는다는 전제다 — 저장이 도는 동안 폼은 잠기고, 과목 삭제는 폼을 막는 창에서만 실행된다.
 * ⚠️ effect가 아니라 렌더 중 파생이다(effect 안 setState 금지 — gotchas #25).
 * ⚠️ 비교는 키 순서와 무관하게 한다 — 서버가 돌려준 값은 키 순서가 달라(jsonb) 글자 비교로는 늘 '바뀜'으로 잡힌다.
 */
export function useSectionDraft<T>(initial: T, token: string | undefined, version?: number): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  /** 이 draft가 출발한 서버 상태의 표식 — 저장 요청에 싣는다. */
  baseline: string | undefined;
  /** 확정 스냅샷과 다른가(작성 중인 변경이 있나). */
  isDirty: () => boolean;
  /** 제출 직전에 부른다 — 지금 draft가 "제출한 값"이고, 응답이 올 때까지 서버 값 받기를 미룬다. */
  noteSubmitted: () => void;
  /** 저장 성공 — 제출한 값을 확정하고 서버가 돌려준 새 기준·저장 순번으로 옮긴다. */
  confirmSaved: (nextToken: string | undefined, nextVersion?: number) => void;
  /** 저장 실패 — 아무것도 확정하지 않고, 미뤄 둔 서버 값을 다시 본다. */
  noteSaveFailed: () => void;
  adopt: (next: T, nextToken: string | undefined, nextVersion?: number) => void;
  /** 서버 값으로 draft를 갈아끼운 횟수 — 폼이 미저장 가드의 기준을 다시 잡는 신호. */
  adoptions: number;
} {
  const incoming = useMemo(() => stableStringify(initial), [initial]);
  const [draft, setDraft] = useState<T>(initial);
  const [confirmed, setConfirmed] = useState(incoming);
  const [baseline, setBaseline] = useState(token);
  /** 확정 상태의 저장 순번 — 이보다 먼저 읽힌 값은 받지 않는다. */
  const [confirmedVersion, setConfirmedVersion] = useState(version);
  const [seen, setSeen] = useState({ incoming, token, version });
  const [adoptions, setAdoptions] = useState(0);
  const [inFlight, setInFlight] = useState(false);
  const submitted = useRef<T>(initial);

  // 저장이 도는 동안에는 보지 않는다(`seen`도 그대로 둔다 — 응답이 반영된 다음 렌더에서 다시 본다).
  if (!inFlight && (seen.incoming !== incoming || seen.token !== token || seen.version !== version)) {
    setSeen({ incoming, token, version });
    // 내 확정 상태보다 먼저 읽힌 값이면 버린다(깨끗하든 아니든) — 받으면 방금 저장한 내용이 옛 값으로 돌아간다.
    if (!isOlderRev(version, confirmedVersion) && stableStringify(draft) === confirmed) {
      // 깨끗하다 — 서버 값과 뜻이 같으면 draft 객체는 그대로 두고(화면이 흔들리지 않게) 기준만 옮긴다.
      if (confirmed !== incoming) {
        setDraft(initial);
        setConfirmed(incoming);
        setAdoptions((n) => n + 1);
      }
      setBaseline(token);
      setConfirmedVersion(version ?? confirmedVersion);
    }
  }

  const isDirty = () => stableStringify(draft) !== confirmed;
  const noteSubmitted = () => {
    submitted.current = draft;
    setInFlight(true);
  };
  const confirmSaved = useCallback((nextToken: string | undefined, nextVersion?: number) => {
    setConfirmed(stableStringify(submitted.current));
    // 서버가 새 기준을 안 돌려줬으면 옛 기준을 그대로 둔다 — 다음 저장이 거절될 뿐 덮어쓰지는 않는다.
    if (nextToken) setBaseline(nextToken);
    if (nextVersion !== undefined) setConfirmedVersion(nextVersion);
    setInFlight(false);
  }, []);
  const noteSaveFailed = useCallback(() => setInFlight(false), []);
  const adopt = useCallback((next: T, nextToken: string | undefined, nextVersion?: number) => {
    setDraft(next);
    setConfirmed(stableStringify(next));
    setBaseline(nextToken);
    if (nextVersion !== undefined) setConfirmedVersion(nextVersion);
    setAdoptions((n) => n + 1);
  }, []);

  return { draft, setDraft, baseline, isDirty, noteSubmitted, confirmSaved, noteSaveFailed, adopt, adoptions };
}
