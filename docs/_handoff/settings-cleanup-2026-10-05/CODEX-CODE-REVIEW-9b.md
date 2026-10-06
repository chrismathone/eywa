# 적대적 코드 리뷰 9b

- **(1) 문제 없음** — tipProps·상태별 접근성 이름은 바깥 span에 그대로 있고, 덮개는 aria-hidden·pointer-events-none이다(`src/features/onescreen/components/cn-badge.tsx:46`, `:63`). EyIcon도 기본 aria-hidden·focusable=false다(`src/components/icons/aywa-icons.tsx:999`, `:1004`). 직접 SVG가 없어 아이콘 가드에 걸리지 않고(`src/components/icons/aywa-icon-mapping.test.ts:201`), `top-[46%]`는 글자 크기 금지 패턴에 해당하지 않는다(`src/components/ui/control-scale.test.ts:51`). 두 색 토큰도 정의돼 있다(`src/app/globals.css:145`, `:177`).
- **(2) 문제 없음 — C1 닫힘** — ok 하나·hold 하나인 같은 반을 실제 집계한 뒤 okBoards={}와 다른 반 행의 elsewhere 부재를 모두 검사한다(`src/features/onescreen/classnote-match.test.ts:121`). 원시 ok 행을 배정 근거로 삼는 회귀를 잡는 단언이다. 덮개 테스트도 새 span 안의 실제 help 글리프·장식 속성·접근성 이름을 검사한다(`src/features/onescreen/components/cn-badge.test.tsx:32`, `:35`).

새 발견 사항: 없음. 남은 수리 0건.
코드 대조만 수행했으며 테스트·브라우저를 실행하지 않았다.

판정: 커밋 가능
