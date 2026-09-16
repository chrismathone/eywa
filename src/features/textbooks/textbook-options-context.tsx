"use client";

import { createContext, useContext, useId, useMemo, type ReactNode } from "react";

/**
 * ECS 계획 줄의 **교재 칸 제안 목록**(교재목록 마스터, 0266a)의 클라이언트 단일 소스.
 *
 * 왜 컨텍스트인가: 계획 표(`PlanTable` → `PlanRow`)는 주간 시트·월간 '그 날 고치기' 창·자리(JJ) 출석부가
 * **같은 한 벌**을 쓴다. prop으로 내리면 세 호출부를 다 배선해야 하고 한 곳만 빠지면 그 화면에서만
 * 제안이 조용히 사라진다(운영 enum을 `useSubjectMaps()`로 읽는 것과 같은 결).
 *
 * 🔴 **프로바이더 밖이면 빈 목록**이다 — 비로그인 공개 PIN 자리 화면(`/seat/jj`)이 같은 표를 그리는데
 *    거기엔 세션이 없어 교재 마스터를 읽을 수 없다. 빈 목록이면 `<datalist>` 자체를 안 만들고 칸은
 *    지금까지처럼 **자유 입력**으로 그대로 돈다(기능이 없어질 뿐 깨지지 않는다).
 * 🔴 `<datalist>`는 **프로바이더가 한 번만** 그린다 — 줄마다 그리면 한 화면에 (교시 × 최대 20줄)개의
 *    같은 목록이 선다.
 *
 * ⚠️ 타입을 `server/queries.ts`에서 import하지 않는다([[#61]]) — 그 파일은 `server-only`라 클라 번들에
 *    끌어오면 빌드가 깨진다. 모양만 같은 거울을 여기 둔다(서버가 주는 값이 그대로 들어맞는다).
 */
export type TextbookOptionItem = {
  title: string;
  /** 페이지/시간 — 교재를 고르면 그 줄의 **빈** 페이지/시간 칸에만 들어간다. */
  pageTime: string | null;
};
// ⚠️ **구분은 일부러 안 싣는다** — 교재를 골라도 줄의 구분을 자동으로 바꾸지 않으므로(PlanRow 주석)
//    아무도 안 읽는 값이고, 이 배열은 ECS 화면마다 RSC payload로 실려 나간다(창 N개면 N배).

type TextbookOptionsCtx = {
  options: TextbookOptionItem[];
  /** `<input list>`가 가리킬 datalist id. 제안이 0개면 null(= 속성을 아예 안 단다). */
  listId: string | null;
};

const EMPTY_OPTIONS: TextbookOptionItem[] = [];
/** 프로바이더 밖 폴백 — **모듈 상수**라 참조가 안정적이다(매 렌더 새 객체면 memo가 통째로 깨진다). */
const EMPTY_CTX: TextbookOptionsCtx = { options: EMPTY_OPTIONS, listId: null };

const Ctx = createContext<TextbookOptionsCtx | null>(null);

export function TextbookOptionsProvider({
  options,
  children,
}: {
  options: TextbookOptionItem[];
  children: ReactNode;
}) {
  // `useId`는 SSR·CSR이 같은 값을 내 하이드레이션이 안 깨진다. React 19의 id는 `«r0»` 모양이라
  // 눈으로 읽기 어렵고 도구가 싫어할 수 있어 영숫자만 남긴다(고유성은 그 부분이 이미 보장한다).
  const rawId = useId();
  const value = useMemo<TextbookOptionsCtx>(() => {
    if (options.length === 0) return EMPTY_CTX;
    return { options, listId: `textbook-titles-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}` };
  }, [options, rawId]);

  return (
    <Ctx.Provider value={value}>
      {value.listId ? (
        <datalist id={value.listId}>
          {value.options.map((o) => (
            <option key={o.title} value={o.title} />
          ))}
        </datalist>
      ) : null}
      {children}
    </Ctx.Provider>
  );
}

/** 교재 제안 목록 + datalist id. 프로바이더 밖이면 빈 목록 + null id. */
export function useTextbookOptions(): TextbookOptionsCtx {
  return useContext(Ctx) ?? EMPTY_CTX;
}
