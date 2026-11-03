/** 테스트 반 판정 — 화면 코드도 쓰는 작은 모듈이다(`work-targets.ts`는 서버 판정을 함께 불러온다). */
export const isTestClass = (name: string) => /(?:^|[\s([_-])(?:테스트(?:반)?|test(?:\s*class)?|sandbox)(?=$|[\s)\]_-])/iu.test(name);
