# Tennis Homepage V2 회원 로그인·권한 구현계획

작성일: 2026-09-17

## 0. 이 문서의 상태

- Phase A DB 기반 작업은 2026-09-17 적용·검증 완료했다.
- 적용 마이그레이션: `20260916152242_club_member_accounts_and_member_rsvp.sql`
- 기존 V1의 Google 관리자 로그인과 기존 관리자 쓰기 정책은 삭제하지 않고 유지했다.
- `club_member_accounts`, 비공개 helper, 회원용 `set_my_schedule_rsvp()`를 추가했다.
- 관리자/미승인 사용자 권한 테스트와 Supabase advisor 재검사를 완료했다.
- Kakao Provider 활성화와 V2 Auth·개인화 기반이 적용됐다. 후속 로컬 작업으로 이메일 scope 제외, 저장소 격리, 회원 RSVP RPC 연결, 권한별 UI와 배포 파일 정리를 진행했다.
- V2 GitHub Pages 배포와 정상 Kakao 로그인 화면 진입을 확인했다. 이메일 없는 실제 로그인과 김지석 일반 회원 승인을 완료했고, 원격 DB 회원 RSVP 권한을 rollback 테스트로 검증했다. 최신 진행 기록은 [현재 1차 계획](v2-phase-1-plan-2026-09-17.md)을 따른다.
- 아래의 설계·단계별 설명에는 초기 설계 시점의 내용이 포함된다. DB 적용·advisor 기록은 당시 작업 기록이며 이번 후속 작업에서 재실행하지 않았다.

## 1. 현재 확인된 구조

### Supabase

- Organization: `cafeSowoo Org`
- Plan: Free
- 현재 활성 프로젝트: `tennis-homepage-preview`
- Project ref: `myincubzgvhyreyqbban`
- 초기 조사 당시 Auth 사용자: 1명, Google provider 사용 (현재 사용자 수 재조회 안 함)
- 기존 회원: `public.members` 16명
- 테니스와 `osaka_trip_*` 앱이 같은 Supabase 프로젝트를 공유하는 구조
- DB 용량은 현재 약 13 MB 수준

### V2 프론트엔드

- 정적 GitHub Pages 앱
- 핵심 파일: `index.html`
- Supabase JS는 CDN으로 로드
- 현재 V2 로그인: Kakao OAuth (V1 Google 유지)
- 현재 사용자: 승인된 `club_member_accounts.member_id`로 연결. `MY_NAME` 제거 완료
- 현재 관리자 판정: `OWNER_EMAIL = "harminis@gmail.com"`
- 현재 V2 `env.js`의 `siteUrl`: `https://cafesowoo.github.io/tennis-homepage-v2/`

### 이미 존재하는 테니스 데이터 구조

- `members`
- `schedules`
- `courts`
- `court_units`
- `events`
- `discussions`
- `schedule_declines`
- `schedule_rsvp_overrides`
- `kakao_*`

`schedule_rsvp_overrides`는 이미 `(schedule_id, member_id, state)` 구조이며 `state`는 `attending / declined / pending`을 사용한다.

## 2. 목표 구조

```text
                       Supabase
                tennis-homepage-preview
                         │
          ┌──────────────┴──────────────┐
          │                             │
      기존 V1                       회원용 V2
  tennis-homepage               tennis-homepage-v2
          │                             │
  Google 관리자 로그인             Kakao 로그인
          │                             │
  일정/코트 전체 관리        본인 RSVP / 내 일정 / 댓글
          └──────── 같은 테니스 데이터 ────────┘
```

핵심 원칙:

1. `schedules`, `members`, `courts` 등 핵심 일정 데이터는 V1/V2가 공유한다.
2. V1 관리자 기능은 현재 동작을 유지한다.
3. V2 일반 회원은 본인과 연결된 `member_id` 범위만 수정한다.
4. 화면에서 버튼만 숨기는 방식이 아니라 DB RLS/RPC에서 권한을 강제한다.
5. Kakao nickname/email 같은 `user_metadata`는 표시·승인 참고 용도로만 사용하고 권한 판단에는 사용하지 않는다.

## 3. 신규 테이블: `club_member_accounts`

Supabase Auth 사용자와 기존 `members` 행을 연결한다.

권장 컬럼:

```text
user_id         uuid PK -> auth.users.id
member_id       text NULL -> public.members.id
requested_name  text NULL
provider        text NULL
role            text NOT NULL DEFAULT 'member'
status          text NOT NULL DEFAULT 'pending'
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
approved_at     timestamptz NULL
```

제약:

```text
role   = member | admin
status = pending | approved | disabled
```

중요:

- `user_id`만 PK/UNIQUE로 둔다.
- `member_id`에는 UNIQUE 제약을 두지 않는다.
- 따라서 김지석 회원 하나에 Google Auth 계정과 Kakao Auth 계정을 둘 다 연결할 수 있다.

예시:

```text
Google auth user A ─┐
                    ├─> member-kim-jiseok
Kakao auth user B ──┘
```

## 4. 회원 승인 흐름

### 최초 Kakao 로그인

1. Kakao OAuth 성공
2. Supabase `auth.users` 생성/로그인
3. V2가 `club_member_accounts`에서 `auth.uid()` 행 조회
4. 행이 없으면 본인 `user_id`로 `pending` 행 생성
5. `requested_name`은 Kakao nickname을 참고값으로 저장 가능
6. 화면에 `회원 승인 대기 중` 표시

회원이 직접 지정할 수 없는 값:

- `member_id`
- `role`
- `approved` 상태

### 관리자 승인

관리자가 pending 계정을 기존 회원과 연결한다.

```text
requested_name: "지석"
        ↓
member_id: member-kim-jiseok
status: approved
role: member 또는 admin
```

초기 테스트 단계에서는 Supabase SQL/관리 도구로 승인하고, 기능 안정화 후 V2에 관리자 전용 `회원 승인` UI를 추가한다.

## 5. `club_member_accounts` RLS 설계

Data API 권한은 자동 노출 여부에 기대지 않고 명시적으로 설정한다.

- `anon`: 권한 없음
- `authenticated`: 필요한 `SELECT`, `INSERT`만 우선 부여
- 관리자 승인 UI를 구현하는 단계에서 `UPDATE` 권한을 추가하되 RLS로 admin만 통과시킨다.
- 테이블 생성 직후 RLS를 먼저 활성화하고 정책을 만든 다음 GRANT를 적용한다.

일반 회원:

- SELECT: 본인 `user_id = auth.uid()` 행만 가능
- INSERT: 본인 `user_id` + `member_id IS NULL` + `role='member'` + `status='pending'`만 가능
- UPDATE: 불가
- DELETE: 불가

관리자:

- SELECT/INSERT/UPDATE/DELETE 가능

관리자 판정과 현재 승인 회원 ID 조회는 RLS 재귀를 피하기 위해 `private` schema의 helper function으로 분리한다.

권장 helper:

```text
private.current_club_member_id()
private.is_club_admin()
```

보안 원칙:

- helper는 `SECURITY DEFINER`가 필요한 경우 `private` schema에만 둔다.
- `search_path`를 고정한다.
- `auth.uid()`가 NULL이면 즉시 권한 없음으로 처리한다.
- `PUBLIC` execute 권한은 제거한다.
- 필요한 `authenticated` 역할에만 execute를 부여한다.
- helper에 외부가 임의의 `user_id`를 전달하는 인자를 만들지 않는다.

## 6. RSVP 쓰기 경로 설계

### 현재 문제

현재 V2의 본인 참석/불참도 내부적으로 다음 관리자용 경로를 사용한다.

```text
persistScheduleAttendees()
  -> schedules.attendee_ids 전체 배열 UPDATE

persistScheduleDecline()
  -> schedule_declines 직접 INSERT/DELETE

Kakao 일정
  -> set_schedule_rsvp(schedule_id, member_id, state)
```

이 방식을 일반 회원에게 열면 클라이언트가 `member_id`나 전체 참석자 배열을 변조할 수 있으므로 그대로 사용할 수 없다.

### 권장 방식

회원용 RPC를 새로 만든다.

```text
public.set_my_schedule_rsvp(
  p_schedule_id text,
  p_state text
)
```

중요하게 **`member_id`를 인자로 받지 않는다.**

처리 흐름:

1. `auth.uid()` 확인
2. `private.current_club_member_id()`로 승인된 본인 `member_id` 확인
3. 대상 schedule을 잠금/조회
4. `p_state`가 `pending / attending / declined`인지 확인
5. 본인의 상태만 변경
6. 변경된 schedule 또는 결과 상태 반환

### 함수 권한 구조

권장:

```text
public.set_my_schedule_rsvp()        SECURITY INVOKER wrapper
                ↓
private.set_my_schedule_rsvp_impl()  제한된 SECURITY DEFINER worker
```

- 실제 privileged DML은 노출되지 않은 `private` 함수에 둔다.
- public wrapper는 임의 `member_id`를 전달할 수 없게 한다.
- private worker가 `auth.uid()`와 승인 상태를 다시 검증한다.

### 일반 일정 (`source != kakao`)

`attending`:

- 본인 ID를 `schedules.attendee_ids`에 추가
- 본인의 `schedule_declines` 행 삭제

`declined`:

- 본인 ID를 `schedules.attendee_ids`에서 제거
- 본인의 `schedule_declines` 행 upsert

`pending`:

- 본인 ID를 `schedules.attendee_ids`에서 제거
- 본인의 `schedule_declines` 행 삭제

### Kakao 일정 (`source = kakao`)

- 기존 `schedule_rsvp_overrides` 사용
- 본인 `(schedule_id, member_id)` 행만 upsert
- 기존 `resolve_schedule_rsvp` 처리와 호환
- `카카오 상태 따르기`는 override 행 삭제 의미를 유지

### 서버측 검증

프론트엔드 체크만 믿지 않고 RPC에서도 최소한 다음을 검증한다.

- 승인 회원 여부
- 일정 존재 여부
- 허용된 state인지
- 참석 전환 시 `closed` 여부
- 참석 전환 시 정원(현재 UI 상수 16명) 초과 여부

## 7. 댓글 권한 설계

### 작성

`discussions.member_id`는 반드시 `private.current_club_member_id()`와 같아야 한다.

추가 RLS 개념:

```text
approved member INSERT own discussion
```

### 삭제

현재 프론트엔드에는 댓글 삭제 기능 자체가 없다.

추가 RLS 개념:

```text
member DELETE own discussion
admin  DELETE any discussion
```

V2 UI:

- 홈페이지 댓글 중 `row.memberId === myMemberId()`인 경우 `삭제` 버튼 노출
- admin은 모든 홈페이지 댓글 삭제 가능
- Kakao에서 가져온 댓글 snapshot은 홈페이지에서 삭제하지 않는다.

### 읽기

초기 V2 구현에서는 기존 public SELECT 정책을 유지해 V1 호환성을 우선한다.

V2 안정화 이후 별도 단계에서 다음 공개 범위를 재검토한다.

- 댓글: 회원 전용으로 전환할지
- RSVP/불참 명단: 회원 전용으로 전환할지
- 개인 `events`: 공개 범위 축소가 필요한지

## 8. V2 프론트엔드 변경 지점

### 8.1 Supabase client

현재:

```js
window.supabase.createClient(url, key)
```

변경:

- V1/V2가 같은 `cafesowoo.github.io` origin과 같은 Supabase project를 쓰므로 V2 Auth storage를 별도 namespace로 분리한다.
- 구현 시 현재 사용 중인 supabase-js 버전에서 `auth.storageKey` 또는 custom storage adapter를 확인해 적용한다.
- Supabase JS CDN은 `@2` floating 대신 테스트한 정확한 v2 버전으로 pin하는 것을 권장한다.

목표:

```text
V1 Google session storage
V2 Kakao session storage
```

가 서로 로그아웃/로그인 상태를 덮어쓰지 않도록 한다.

### 8.2 `env.js`

현재 잘못 남아 있는 값:

```text
siteUrl = https://cafesowoo.github.io/tennis-homepage/
```

V2 구현 시:

```text
siteUrl = https://cafesowoo.github.io/tennis-homepage-v2/
```

로 변경한다.

### 8.3 로그인 provider

V2:

```js
signInWithOAuth({ provider: "kakao" })
```

V1 Google 로그인은 그대로 둔다.

### 8.4 Auth state

현재:

```text
authState.session
authState.user
```

추가:

```text
authState.memberAccount
authState.member
```

상태 예:

```text
로그아웃
로그인됨 + pending
로그인됨 + approved member
로그인됨 + approved admin
로그인됨 + disabled
```

### 8.5 `MY_NAME` 제거

현재 `MY_NAME = "김지석"`를 사용하는 모든 지점을 동적 사용자로 전환한다.

핵심 helper:

```text
myMemberId()
myMember()
myMemberName()
isApprovedMember()
isClubAdmin()
```

로그아웃 또는 승인 대기 상태에서는 `myMemberId()`가 빈 값을 반환하고 개인화 UI를 숨긴다.

### 8.6 쓰기 권한 helper 분리

기존:

```text
requireOfficialWriteAccess()
```

는 V1/관리자 성격의 일정·코트 전체 수정용으로 유지한다.

V2에 추가:

```text
requireApprovedMember()
requireClubAdmin()
```

일반 회원 RSVP/댓글은 `requireOfficialWriteAccess()`를 호출하지 않는다.

### 8.7 RSVP UI

현재 `cycleScheduleRsvp()`의 self RSVP 경로를 회원용 RPC 기반으로 교체한다.

관리자용:

- 참석자 임의 추가/제거
- 기존 `persistScheduleAttendees()`

회원용:

- 내 상태만 `set_my_schedule_rsvp()` 호출

두 경로를 코드 수준에서 분리한다.

### 8.8 댓글 UI

`addDiscussionMessage()`:

- author를 `MY_NAME`으로 찾지 않는다.
- `authState.member.id` 사용
- 승인 회원만 INSERT

추가:

```text
deleteDiscussionMessage(id)
```

- 본인 댓글 또는 admin만 버튼 노출
- 실제 DB 삭제 가능 여부는 RLS가 최종 판단

## 9. 내 일정 구현

새 테이블은 만들지 않는다.

로그인한 `member_id` 기준으로 기존 schedule 데이터를 필터링한다.

```text
attending -> 내 예정 일정
declined  -> 불참 일정(선택 표시 가능)
pending   -> 미정
```

1차 구현 권장 UI:

- 일정 화면 상단에 `전체 / 내 일정` 토글
- `내 일정`에서는 참석 상태인 일정만 표시
- 날짜 순 정렬
- 지난 일정 / 예정 일정 구분

기존 달력의 `내 참석 일정` 강조 로직도 동적 회원 기준으로 바꾼다.

## 10. Kakao 설정

Supabase 공식 Kakao OAuth 방식을 사용한다.

필요 작업:

1. Kakao Developers 앱 생성/확인
2. REST API Key 확인
3. Kakao Login Client Secret 활성화
4. Kakao Login ON
5. Supabase Authentication > Providers > Kakao 활성화
6. Supabase callback URL을 Kakao Redirect URI에 등록
7. Supabase Redirect allow list에 V2 URL 등록
8. V2에서 `provider: "kakao"` 사용

이메일은 Kakao Biz App이 아니면 사용할 수 없을 수 있으므로 회원 식별/권한을 이메일에 의존하지 않는다.

## 11. 마이그레이션 적용 순서

### Phase A — DB 기반만 추가 (V1 무영향)

1. `club_member_accounts` 생성
2. RLS 활성화
3. helper functions 생성
4. 현재 Google 관리자 Auth user를 `member-kim-jiseok`, `role=admin`, `approved`로 연결
5. 회원용 RSVP RPC 생성
6. discussions에 회원 본인 작성/삭제 정책 추가
7. 기존 owner 정책은 유지
8. advisor 실행

### Phase B — V2 Auth

1. `env.js` V2 URL 수정
2. V2 전용 Auth storage 적용
3. Kakao OAuth 연결
4. pending account bootstrap 구현
5. 승인 상태 UI 구현

### Phase C — V2 개인화

1. `MY_NAME` 제거
2. 동적 프로필/아바타
3. 동적 `내 일정`
4. 동적 달력 강조

### Phase D — 회원 쓰기

1. RSVP self RPC 전환
2. 댓글 작성 전환
3. 본인 댓글 삭제 추가
4. 일반 회원에게 관리자 일정/코트 편집 UI 숨김

### Phase E — 테스트

1. 김지석 Kakao 계정 1개로 테스트
2. 일반 회원 테스트 계정 1개 추가
3. 두 계정 동시 브라우저 테스트
4. 타인 RSVP 변경 불가 확인
5. 타인 댓글 삭제 불가 확인
6. pending/disabled 쓰기 불가 확인
7. V1 Google 관리자 기능 회귀 테스트
8. V1/V2 로그인 session 격리 확인

### Phase F — 선택적 개인정보 정리

V2 안정화 후 public SELECT 범위를 별도 검토한다.

## 12. 필수 권한 테스트 시나리오

| 사용자 | 일정 조회 | 내 RSVP | 타인 RSVP | 댓글 작성 | 내 댓글 삭제 | 타인 댓글 삭제 | 일정/코트 편집 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 로그아웃 | 현재 정책 기준 가능 | X | X | X | X | X | X |
| pending | 현재 정책 기준 가능 | X | X | X | X | X | X |
| approved member | O | O | X | O | O | X | X |
| approved admin | O | O | O | O | O | O | O |
| disabled | 현재 정책 기준 가능 | X | X | X | X | X | X |

## 13. 구현 중 절대 피할 것

- Kakao nickname/email을 RLS 권한 기준으로 사용하지 않는다.
- `user_metadata`의 role 값을 신뢰하지 않는다.
- 일반 회원에게 `schedules` 전체 UPDATE를 그대로 열지 않는다.
- 일반 회원 RPC에 임의 `member_id` 파라미터를 받지 않는다.
- 브라우저 코드에 service role/secret key를 넣지 않는다.
- 기존 V1 owner 정책을 한 번에 제거하지 않는다.
- V2가 안정되기 전 기존 public read 정책을 갑자기 닫지 않는다.
- Kakao OAuth와 RLS 변경을 한 번에 적용하지 않고 단계별로 검증한다.

## 14. 구현 시작 시 첫 작업 묶음

실제 변경을 시작할 때는 다음 범위까지만 먼저 진행한다.

1. Supabase migration 파일 생성
2. `club_member_accounts` + RLS + helper 생성
3. 기존 Google 관리자 계정 seed/link
4. 회원용 `set_my_schedule_rsvp` RPC 생성
5. DB 권한 테스트
6. Supabase advisor 확인

이 1차 DB 작업이 검증된 뒤에만 V2의 Kakao OAuth 프론트엔드를 수정한다.
