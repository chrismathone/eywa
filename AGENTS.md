<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 경영 에이전트·학생 케어 검증 (사용자 지시, 2026-10-20)

- 이 작업에는 GitHub Actions를 사용하거나 재실행하지 않는다. 결제·예산 조정을 개발의 선행 조건으로 요구하지 않는다.
- `codex/management-agent-mvp`, `codex/student-care-mvp`는 로컬 타입 검사·lint·테스트·빌드로 검증하고 결과를 PR에 기록한다.
- 이 두 작업 브랜치의 커밋·병합 커밋에는 `[skip ci]`를 포함해 `push`/`pull_request` 워크플로 시작을 막는다. `ci.yml`의 해당 브랜치 실행 제외 조건도 유지한다.
- MakeEdu의 수동 Actions 워크플로도 이 작업에서 호출하지 않는다. 운영 배포·DB 변경·외부 알림은 기존 별도 승인 범위를 따른다.

## 일반 화면의 문구 원칙 (사용자 지시, 2026-10-02)

- 일반 지점 화면의 설명·도움말·툴팁·오류 메시지에 `슈퍼관리자`, `슈퍼어드민`, `super_admin`, `총괄`(플랫폼 총괄 관리자를 가리킬 때 — '발송 총괄'처럼 업무를 뜻하는 말은 해당 없음) 같은 플랫폼 내부 역할이나 권한 우회·자동 통과 여부를 노출하지 않는다. 사용자가 할 수 있는 작업과 필요한 안내만 적는다.
- 실제 접근 권한과 계정 보호 로직은 유지한다. 운영자 전용 콘솔의 역할 관리는 별도이며, 일반 지점 화면에 관련 설명을 덧붙이지 않는다.
- DB 트리거의 `raise exception` 문구도 같은 원칙이다 — 한글 사유는 화면에 그대로 뜰 수 있다(`describeDbError`). 새 트리거 문구에 위 역할 이름을 쓰지 않는다.
