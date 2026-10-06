# 적대적 코드 리뷰 9

차단 0건·중요 0건·경미 1건. 코드 대조만 했으며 테스트·DB·스크립트·브라우저는 실행하지 않았다.

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
|---|---|---|---|---|
| C1 | 경미 | `src/features/onescreen/classnote-match.test.ts:19`, `:115` | 기존 혼합 상태(원아 둘 중 ok 하나·hold 하나) 사례는 byKey의 hold만 검사한다. 새 ‘다른 반 hold’ 사례는 hold 하나뿐이다. okBoards를 집계 결과 대신 원시 ok 행에서 만들면 혼합 상태 반도 다른 반의 확인 배정으로 표시되지만 이 두 단언은 그대로 통과한다. **현재 구현은 집계된 hold를 제외하므로 정상이다**(`classnote-match.ts:91`). | 혼합 상태 반이 okBoards에 없고, 그 학생의 다른 반 행에도 elsewhere가 생기지 않는 사례를 추가한다(경미 후속). |

확인한 실행 경로:

- **연결 근거:** 신원 확인·동명이인 등에 막힌 계획은 child_name=null로 기록하며, 확인을 통과한 원아의 배정 대기만 이름을 남긴다(`scripts/_classnote/class-board-plan.mjs:220`, `:227`; `math-class-boards-db.mjs:48`, `:52`). 후보 이름을 연결 완료로 오인하는 경로는 발견하지 못했다. 생성 대상도 수학 두 키다(`math-class-boards-load.mjs:18`).
- **반별 판정:** 한 원아라도 hold이면 집계 hold가 유지되고 okBoards에서 빠진다(`classnote-match.ts:83`, `:91`). 발송 대상 밖 반이라도 저장된 ok 보드 연결은 다른 배정의 근거로 남긴다(`:90`); 현재 행 자체는 과목·대상 반 검사 후에만 그린다(`:122`). 현재 반 발송 허용을 넓히는 변경은 없다. 조회 함수의 기존 세 조회도 그대로다(`src/features/onescreen/server/classnote-match.ts:23`).
- **공개 범위:** 기존 원스크린 tags는 담당 반 기준이며(`server/roster.ts:593`, `:725`), 이번에는 같은 로스터 학생의 다른 확인 보드 이름이 추가된다(`classnote-match.ts:109`; `src/app/(shell)/onescreen/page.tsx:195`). 다른 반 사유·원아 이름은 새 목록에 없다(`classnote-match.ts:93`). 담당 학생의 다른 수강 반 이름은 기존 학생 요약에서도 열람하던 정보다(`src/features/students/server/queries.ts:780`, `:1983`, `:2025`). 다른 강사 뷰도 대상 강사 로스터의 학생 목록을 그대로 사용한다(`server/roster.ts:354`).
- **호환·표시:** 카드·표 모두 같은 판정과 CnBadge를 쓴다(`components/onescreen-client.tsx:4716`; `components/grid-row.tsx:401`). unavailable·옛 okBoards 없는 지도는 기존 null/회색 경로로 처리된다(`classnote-match.ts:121`, `:128`). 새 영어 문구도 실제로 전달한다(`components/cn-badge.tsx:39`; `src/features/teacher-view/i18n.ts:3188`). SVG는 pointer-events-none·aria-hidden이며 tip은 바깥 span에 유지된다(`components/cn-badge.tsx:45`, `:62`). 색은 정의된 토큰이고 위치의 `top-[46%]`는 글자 크기 가드 대상이 아니다(`src/app/globals.css:177`; `src/components/ui/control-scale.test.ts:51`).
- **검증·문서:** 새 테스트는 세 상태의 SVG·회색 처리·접근성 이름과 다른 학생 배정 제외를 실제 결과로 검사한다(`components/cn-badge.test.tsx:18`, `:26`, `:37`; `classnote-match.test.ts:120`). 문서의 세 상태·보류 원아 근거는 위 writer와 맞는다. 실시간 ClassNote 원격 상태의 일치는 미확인이며, 이 화면은 종전처럼 저장된 동기화 기록을 표시한다.

판정: 커밋 가능
