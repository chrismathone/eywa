# 기존 워커 가상 점검 및 실행 잠금 보완 검증

이 문서는 13:19 KST의 과거 검증 기록이다. 이후 통합 앱 1.0.0을 구현했으며 최신 결과는 [통합 앱 수용 검증](./sync-agent-acceptance-2026-10-08.md)에 있다. 아래의 “아직 구현되지 않음” 판정은 당시 상태를 기록한 것이다.

2026-10-08 13:19 KST 최종 판정: **선택한 254개 테스트 파일, 3,936개 통과·실패 0개·건너뜀 0개. 기존 잠금 결함 4개 해소, 격리 PostgreSQL 검사 12개 통과.**

이 결과는 기존 클래스노트·makeedu·영상 워커와 관련 웹 기능의 회귀 검사, ClassNote 실행 잠금 보완에 대한 검증이다. **통합 EXE·기기 등록·자동 업데이트·새 `연동 PC` 화면은 아직 구현되지 않았으며, 제품 전체의 검증 완료나 배포를 뜻하지 않는다.** 이번 검증에서 운영 DB·현재 시간표·연동 PC·Google 저장 설정은 변경하지 않았다.

## 최종 실행 결과

| 검사 | 결과 | 범위 |
|---|---|---|
| 기존 워커 및 잠금 회귀 | 71개 파일, 1,228개 통과 | 클래스노트·makeedu의 판정, 가짜 DB/외부 서비스, 구문 검사, 실제 OS 잠금, 실제 FFmpeg |
| 관련 웹 회귀 | 183개 파일, 2,708개 통과 | 발송/공지/회수·권한·답글/공감·수납/교재·Google 계정/폴더/업로드·숙제 장부·상태 화면 등 |
| 합계 | **3,936개 통과·실패 0개·건너뜀 0개** | 워커·영상 관련 파일/본문을 기준으로 선택. 저장소 전체 테스트를 모두 실행했다는 뜻은 아님. |
| DB 실행 잠금 | **12개 통과** | 실제 PostgreSQL 17 격리 DB. 64개 동시 요청 중 하나만 승인, 갱신·인계·권한·롤백 확인. |
| 기존 결함 재현 조건 | **4개 모두 해소** | 아래 LEGACY01~04. 과거 실패 결과는 보존. |
| 통신 차단 자체 검사 | 7개 통과 | fetch·HTTP·HTTPS·TCP·TLS·DNS·UDP 차단. 의도적인 자체 검사 시도는 별도 기록. |
| 오프라인 본 검사의 외부 통신 시도 | 0건 | 운영용 환경변수 제거 후 Node 통신 차단. DB 검사는 별도로 검증한 로컬 컨테이너에만 접속. |
| 검사 도중 워커 소스 변경 | 0개 | 스크립트/설치 도구 182개 파일의 실행 전후 SHA-256 일치. 이 수치는 수정 전 원본과 같다는 뜻이 아님. |

최종 실행: 13:16~13:19 KST, Node v24.13.0 / Windows. 원본 근거:

- [실행 요약](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/summary.json)
- [선택 파일과 워커 해시](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/manifest.json)
- [테스트별 결과](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/vitest-results.json)
- [실제 DB 검사 결과](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/database-check.json)
- [기존 잠금 결함 재검사](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/legacy-safety-findings.json)
- [검증 후 파일 해시 442개](../../work/unified-sync-agent-dryrun/2026-10-08T04-16-06.409Z/verification-snapshot.json)

`regressionPassed: true`, `virtualChecksPassed: true`, `legacySafetyGaps: 0`을 확인했다. `unifiedExeAcceptance: NOT_IMPLEMENTED_NOT_TESTED`는 그대로 유지한다.

## 발견한 문제와 보완

| ID | 최초 재현 조건 | 수정 및 확인 |
|---|---|---|
| LEGACY01 | heartbeat 목록이 비면 두 PC 모두 자신이 담당자로 판단 | DB 원자적 승인 없이는 작업 시작 불가. 실제 DB 64개 선점 요청에서 소유자 1명. |
| LEGACY02 | 같은 Windows 이름을 쓰는 두 PC가 모두 담당자로 판단 | 이름은 표시용으로만 사용. 프로세스마다 UUID를 만들고 서버의 실행 세대와 함께 갱신/해제 검증. |
| LEGACY03 | 잠금 파일 쓰기 권한 오류를 실행 허용으로 처리 | OS 잠금 실패 시 대기. EACCES와 지원하지 않는 환경에서 업무 시작을 거절. |
| LEGACY04 | 파일 읽기/쓰기 사이의 경쟁으로 두 프로세스 모두 승인 | Windows named pipe로 교체. 24개 동시 획득에서 소유자 1명, 실제 자식 프로세스 강제 종료 후 인계 확인. |

추가로 갱신 응답을 기다리다 절전 등으로 로컬 만료 시각을 넘겼을 때, 감시 타이머보다 성공 응답이 먼저 처리되면 만료된 실행이 되살아날 수 있는 조건을 재현해 수정했다. 이제 기존 유효시간도 다시 확인하고, 한 번 소실된 실행은 늦은 성공으로 복구하지 않는다. 동시 획득 요청은 한 DB 요청으로 합치며, 획득 중 해제한 실행도 늦은 승인으로 시작하지 않는다.

변경 근거:

- [OS 실행 잠금](../../scripts/_classnote/worker-lease.mjs), [서버 잠금 유지기](../../scripts/_classnote/worker-execution-lease.mjs)
- [DB 마이그레이션](../../supabase/migrations/0399a_worker_execution_leases.sql)
- [실제 ClassNote 실행기](../../scripts/_classnote/watch-classnote-queue.mjs)
- [잠금 동작 시험](../../scripts/_classnote/worker-lease.test.mjs), [실제 실행기 배선 시험](../../scripts/_classnote/watch-classnote-lease.test.mjs), [DB 경쟁 시험](../../scripts/_sync-agent/lease-db-check.cjs)

실제 실행기 소스를 가짜 의존성과 함께 실행해 기존 16개 업무 단계의 호출 순서를 확인했다. 로컬 잠금 거절·서버 승인 거절·구 워커 활성·마이그레이션 미적용일 때는 브라우저/업무/heartbeat 쓰기를 시작하지 않고, 실행 도중 잠금 소실 시 다음 업무 단계로 넘어가지 않는다. 모듈 OFF일 때 업무를 쉬고 상태만 보내는 동작도 유지한다.

이전 hostname/PID 파일 구현을 전제로 한 `rename-gaps.test.mjs`의 6개 검사를 새 소유권 기준으로 갱신했다. 기존 보고서 중복 대조·학생/보드 연결·동명이인 보호·게시 stale 복구 검사는 유지했다. 초기 확장 검사에서 발견한 감사로그 이름 누락은 [감사로그 등록부](../../src/features/audit/server/log.ts)에 `mcs_learning_goal_revise: 수학 시트 남은 계획 수정`을 등록해 해결했다.

## 영상 압축 검사

이전 실행에서 건너뛴 FFmpeg 실물 검사를 이번에는 실행했다. 가짜 실행기의 단위 검사와 별도로 로컬에서 테스트용 영상·음성을 생성해 압축하고, H.264 High/yuv420p, 세로 화면 방향, 영상 길이, 음성 존재, 용량 절감, faststart를 확인했다. Google Drive에 실제 업로드하지 않았다.

FFmpeg/FFprobe 9.0.2를 작업 폴더에 준비하고 해당 실행의 PATH에만 추가했다. [FFmpeg 공식 다운로드 안내](https://ffmpeg.org/download.html)가 연결하는 [Gyan Windows 빌드](https://www.gyan.dev/ffmpeg/builds/)의 배포 체크섬과 ZIP SHA-256을 대조했다.

```text
60F467265B1E312373DBCD92200C2618A74850F98D3D078E94296BB3FA2047BA
```

## 적용 상태와 남은 범위

- 새 SQL은 격리 DB에만 적용했다. 수정한 ClassNote 워커와 SQL은 운영 배포 전이다. **수정 워커를 배포하려면 마이그레이션을 먼저 적용해야 한다.** 미적용 상태에서는 업무를 시작하지 않는다.
- 구 워커는 새 잠금을 모른다. 운영 전환 때 기존 예약 작업과 부모/자식 프로세스의 종료를 확인하고, 뒤늦게 켜지는 구 PC와 구 접속 자격증명도 정리해야 한다. 구 heartbeat 확인만으로 모든 구판을 차단했다고 판단하지 않는다.
- 새 잠금의 직접 배선은 ClassNote 실행기에 한정된다. Makeedu와 통합 앱의 기기 인증/API 경계는 아직 구현하지 않았다. 기존 직접 DB 접속 계정은 기기별 인증을 대신하지 못한다.
- 실행 세대 검사는 잠금 획득/갱신/해제를 보호한다. 기존 모든 업무 SQL의 완료 기록까지 새 실행 세대로 보호한 것은 아니다. 이미 외부 서비스가 접수한 발송/업로드는 기존 업무별 대조/복구가 필요하며, 정확히 한 번의 외부 실행을 보장했다는 뜻은 아니다.
- 통합 EXE, 12자리 등록 코드, 웹 `연동 PC` 탭, 자동 업데이트/서명/복귀에 대한 [125개 수용 시험](../plans/unified-sync-agent-failure-matrix.md)은 아직 미실행이다. 기존 회귀 통과를 이 목록의 통과로 옮겨 적지 않는다.
- 실제 연동 PC의 makeedu 신뢰 IP 로그인, 실제 Google 계정 접근/업로드/발송, Windows 로그온·재부팅·절전, 백신 잠금·업데이트 중 전원 종료는 별도 실환경 시험이 필요하다. 이번 절전/통신 지연 검사는 가상 시계·응답 주입이다.

운영 적용 순서는 SQL 마이그레이션 → 구 실행기 종료 확인 → 수정 파일 전체 배포 → 단일 실행/지점/설정 확인이다. 이번 요청에서는 이 운영 적용을 실행하지 않았다.

## 재현 방법

Docker가 실행 중이고 로컬 FFmpeg/FFprobe가 준비된 상태에서, 저장소 루트의 PowerShell에서 실행한다. 아래 비밀번호는 테스트 전용이다.

```powershell
docker run --rm -d --name eywa-worker-lease-test-20261008 --label eywa.test=worker-lease -e POSTGRES_PASSWORD=local-fixture-only -p 127.0.0.1::5432 postgres:17-alpine
docker exec eywa-worker-lease-test-20261008 pg_isready -U postgres
# pg_isready가 accepting connections를 반환한 뒤 실행한다.
$env:Path = 'F:\eywa\work\sync-agent-tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin;' + $env:Path
node scripts/_sync-agent/dryrun.cjs
```

검사기는 컨테이너 이름·레이블·이미지·127.0.0.1 포트 바인딩을 확인한 뒤 무작위 이름의 테스트 DB를 만들고 마지막에 해당 DB를 삭제한다. `DATABASE_URL`은 사용하지 않는다. 검사가 끝난 뒤 직접 만든 위 이름의 컨테이너를 확인해 종료하면 된다. 다른 Docker 작업은 종료하지 않는다.

이번 실행에서 만든 테스트 DB와 컨테이너는 검사 후 정리했다. Docker 자체와 다른 컨테이너는 종료하지 않았다.

[실행기](../../scripts/_sync-agent/dryrun.cjs)는 운영 `.env`를 읽거나 워커 `--post/--apply`를 호출하지 않는다. [Node 통신 차단](../../scripts/_sync-agent/dryrun-offline.cjs)을 자체 점검한 다음 회귀 검사를 실행하며, 로컬 DB 검사는 분리된 단계다. 실패·건너뜀·파일 누락·잠금 미충족·외부 통신 시도가 있으면 전체 검사를 실패로 처리한다. 결과는 실행별 `work/unified-sync-agent-dryrun/`에 저장된다. 이는 신뢰된 저장소 테스트용 통신 가드이며 임의 네이티브 프로그램을 통제하는 OS 샌드박스는 아니다.

## 이전 실행 기록

- [최초 점검](../../work/unified-sync-agent-dryrun/2026-10-08T03-11-34.082Z/summary.json): 3,908개 통과, FFmpeg 1개 건너뜀, 잠금 조건 4개 미충족. 당시 원본 결함 재현 기록은 같은 폴더에 남아 있다.
- [수정 후 첫 전체 검사](../../work/unified-sync-agent-dryrun/2026-10-08T04-11-22.085Z/summary.json): 3,927개 통과, 옛 잠금 구현을 전제로 한 검사 6개 실패. 이 실패와 늦은 갱신 응답 경계 조건을 정리한 뒤 위 최종 검사를 다시 실행했다.
