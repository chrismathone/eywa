<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 검증 범위 원칙 (사용자 지시, 2026-10-22)

- 간단한 문구·라벨·스타일·배치 수정에 프로젝트 전체 타입 검사나 전체 테스트를 실행하지 않는다.
- 기본 검증은 변경 파일의 린트·타입 검사와 직접 영향받는 기능의 필요한 확인으로 제한한다. 타입 검사에 필요한 의존성은 포함할 수 있다.
- 공통 타입·공용 기반 구조·빌드 설정 변경 등 전체 영향의 근거가 있거나 사용자가 요청한 경우에만 전체 검사를 실행한다. 단순히 확인을 더 한다는 이유로 범위를 넓히지 않는다.
- 적절한 검증이 통과하면 새 변경이나 구체적인 오류·우려가 없는 한 검사를 반복하거나 확대하지 않는다.
- 이 범위의 검사는 `pnpm verify` 한 번으로 돈다(바뀐 파일 린트 · 바뀐 TS와 그 import·역의존의 타입 · 관련 테스트·파일 이름을 적은 테스트·폴더를 훑는 가드 · main의 기존 실패는 기준선과 비교해 따로 보인다). 전체 타입은 `pnpm verify --all-types`. 자세한 것은 `docs/setup-and-ops.md` "검증 게이트".

## 일반 화면의 문구 원칙 (사용자 지시, 2026-10-02)

- 일반 지점 화면의 설명·도움말·툴팁·오류 메시지에 `슈퍼관리자`, `슈퍼어드민`, `super_admin`, `총괄`(플랫폼 총괄 관리자를 가리킬 때 — '발송 총괄'처럼 업무를 뜻하는 말은 해당 없음) 같은 플랫폼 내부 역할이나 권한 우회·자동 통과 여부를 노출하지 않는다. 사용자가 할 수 있는 작업과 필요한 안내만 적는다.
- 실제 접근 권한과 계정 보호 로직은 유지한다. 운영자 전용 콘솔의 역할 관리는 별도이며, 일반 지점 화면에 관련 설명을 덧붙이지 않는다.
- DB 트리거의 `raise exception` 문구도 같은 원칙이다 — 한글 사유는 화면에 그대로 뜰 수 있다(`describeDbError`). 새 트리거 문구에 위 역할 이름을 쓰지 않는다.
