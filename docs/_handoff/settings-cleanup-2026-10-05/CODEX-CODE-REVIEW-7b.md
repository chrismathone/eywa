# 적대적 코드 리뷰 7b

- **C1: 닫힘** — 보강 설정 링크가 `/owner?tab=makeups`를 가리킨다(`src/app/(shell)/owner/_components/modules-section.tsx:43`). `src` 검색에서 보강 운영 설정을 옛 위치로 보내는 다른 링크는 발견하지 못했다.
- **C2: 부분** — 두 사례의 이름은 실제 DOM 확인 범위로 좁혔다(`src/app/(shell)/owner/_components/settings-collapse.test.tsx:36`, `:49`). 실제 저장 payload·미저장 기준 검증은 합의한 경미 후속으로 남는다.
- 남은 운영 체계 링크는 수강료 계산기의 휴원일 편집(`src/app/(shell)/billing/_components/calculator-panel.tsx:139`, `:143`)과 시작하기의 교시·설정 확인/강의실 등록(`src/features/onboarding/steps.ts:27`, `:33`)이므로 그대로가 맞다.
- 새 검사는 실제 소스의 링크 주소·문구를 함께 검사하고 옛 주소도 금지한다(`src/app/(shell)/owner/_components/settings-collapse.test.tsx:94`). 수리를 되돌리면 95·96행의 단언이 모두 실패하는 구조다. 실행·변이 재검증은 하지 않았다.

새 발견 사항: 없음. 차단·중요 0건이며 C2의 저장 검증만 후속이다.

판정: 커밋 가능
