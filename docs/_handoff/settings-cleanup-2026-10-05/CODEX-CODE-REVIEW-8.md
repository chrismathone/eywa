# 적대적 코드 리뷰 8

차단 0건·중요 2건·경미 1건. 테스트·서버·DB·스크립트는 실행하지 않았다.

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
|---|---|---|---|---|
| C1 | 중요 | `src/features/report-admin/server/classnote-sync-actions.ts:104`, `:179`, `:190`; `src/features/audit/describe.ts:1155` | 보고서 쓰기 권한자가 문맥 밖에서 직접 `requestClassnoteBoardSync({ source: "send_blocked" })` 호출 → 권한 검사 통과 → 호출자가 준 source를 기록 → 수동 요청이 ‘자동 동기화 요청’으로 표시된다. 기존 요청에 합류해도 같다. | 새 감사 행의 자동 여부는 `isAutoSyncRequest()`로 서버가 확정한다. 수동 호출의 예약 source는 정정/거절하거나 별도 서버 표식을 저장한다. 옛 행의 source 해석은 호환용으로만 유지하고 권한자의 위조·합류 사례를 검증한다. |
| C2 | 중요 | `src/features/report-admin/server/classnote-sync-actions.ts:40`; `src/lib/permissions.ts:210`; `src/lib/auth/perm-matrix.ts:108`; `CLAUDE.md:453` | `systemRole=teacher`, 운영자 명단에는 있음, `lesson_reports` 부여는 없음 → 기본값 none이며 운영자에게 강제로 여는 목록에도 이 키는 없음 → teacherOnly=true → 종전에는 허용하던 직접 요청을 이제 거절한다. 운영자 판정은 역할과 독립이다(`src/lib/auth/super-admin.ts:45`). **해당 조합의 실계정 존재는 미확인**이나 입력에 대한 거절 경로는 코드로 확인했다. 새 제한은 운영자를 자동 통과시킨다는 저장소 규칙과 어긋난다. | 기존 모듈·읽기 전용 가드는 유지하면서 새 teacherOnly 직접 요청 제한에 운영자 예외를 적용한다. 동기화 보고서의 canExport 판정은 따로 유지하고 해당 역할 조합을 검증한다. |
| C3 | 경미 | `src/features/report-admin/server/classnote-sync-actions.test.ts:219`; `src/features/report-admin/classnote-sync.ts:38` | 자동 요청 성공 사례의 `c1`·`s1`은 UUID 검증에서 빠져 실제 저장 범위는 full=true다. insert 1건·source만 검사하므로 ‘그 반·학생만’과 내부 상태 재조회가 계속 허용되는지는 확인하지 않는다. | 유효 UUID를 쓰고 저장 scope와 응답 status.available=true도 검사한다. send-class의 모의 요청 안에서 실제 `isAutoSyncRequest()`를 검사하면 감싸기를 제거하는 회귀도 잡는다. |

확인한 실행 경로:

- 강사 직접 요청은 쓰기 전에 거절한다(`classnote-sync-actions.ts:100`). 공용 버튼 4곳은 숨김이면 null·폴링 없음(`classnote-sync-now-button.tsx:82`, `:93`); 다운로드도 별도 권한 검사 유지(`classnote-sync-report-actions.ts:30`). 다른 앱 쓰기 진입점은 없고 사용자 DB 쓰기 정책도 없다(`supabase/migrations/0313a_classnote_sync_requests.sql:46`).
- 서버 전용 `run`은 액션 전체 Promise를 감싼다(`classnote-sync-auto.ts:15`; `send-class.ts:107`). 내부 상태 재조회까지 문맥 안이고 await 뒤에도 유지되는 Node 계약이다(`node_modules/@types/node/async_hooks.d.ts:436`). 발송 보류 판정·요청 표 되읽기는 그대로(`send-class.ts:102`, `:110`). 배포 환경 동시 요청 실측은 미확인이다.
- 관리자 본인 강사뷰·겸직은 실제 역할의 보고서 쓰기 권한으로 통과하고 다른 강사 뷰는 기존 쓰기 캡으로 막힌다(`src/lib/auth/perm-matrix.ts:131`; `classnote-sync-actions.ts:43`). 관리자 역할 운영자는 통과하며 강사 역할의 경계만 C2다.
- 옛 버튼/없는 source는 수동, send_blocked는 자동이며 joined·full도 구분된다(`describe.ts:1152`). PC의 auto=true 분기는 종전 그대로(`:1140`; `scripts/_classnote/classnote-auto-sync.mjs:118`). 감사 목록도 이 상세를 쓴다(`src/app/(shell)/owner/_components/audit-face.tsx:254`). 새 거절·문맥 종료·문구 테스트는 유효하나 C1/C2 입력이 없다(`classnote-sync-actions.test.ts:205`, `:225`; `describe.test.ts:1311`).

판정: 수리 필요(C1·C2)
