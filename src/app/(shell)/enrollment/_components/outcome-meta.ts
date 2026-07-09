// 등록상담 진행 상태 메타 — 구현이 `@/features/enrollment/outcome-meta`로 승격됨(연동 카드 등 features에서도
// 소비하기 위해). 이 파일은 re-export shim(기존 import 무변경). 새 코드는 features 쪽을 직접 import.
export { OUTCOME_PILL, OUTCOME_OPTIONS, outcomePill } from "@/features/enrollment/outcome-meta";
