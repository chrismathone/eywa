import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * **시스템이 대신 내는** 반 보드 동기화 요청의 표식(원장 2026-10-06 *"선생님 버튼은 자동 동기화 요청에 의한 건 아니면
 * 누를 수 없게"*). 선생님은 '지금 반 보드 동기화' 버튼을 직접 누를 수 없고, 원스크린 발송이 배정 보류로 막혔을 때
 * 서버가 그 반·학생만 대신 요청하는 길만 열려 있다.
 * 🔴 `"use server"` 파일의 export는 클라이언트가 직접 부를 수 있는 액션이라, 인자(예: source)로 구분하면 선생님이 값을
 *    꾸며 보낼 수 있다. 그래서 서버 코드만 들어갈 수 있는 실행 문맥(AsyncLocalStorage)으로 표시한다.
 */
const store = new AsyncLocalStorage<true>();

/** 이 안에서 낸 동기화 요청은 선생님 역할도 허용된다(서버 코드 전용). */
export function runAsAutoSyncRequest<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(true, fn);
}

export const isAutoSyncRequest = (): boolean => store.getStore() === true;
