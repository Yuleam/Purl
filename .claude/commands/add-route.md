새 Express 라우트를 추가한다.

## 입력
- $ARGUMENTS: 라우트 이름 (예: "knots")

## 작업 순서
1. server/routes/$ARGUMENTS.js 파일 생성
   - 기존 라우트(예: server/routes/stitches.js) 패턴을 따를 것
   - sql.js 사용, async/await 패턴
2. server/index.js에 라우트 등록
3. 필요한 DB 테이블이 없으면 server/db.js에 CREATE TABLE 추가

## 규칙
- LLM/외부 AI API 사용 금지
- 에러 핸들링은 기존 라우트와 동일한 패턴