FROM node:20-slim

WORKDIR /app

# better-sqlite3 빌드에 필요한 네이티브 도구
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# 의존성 설치
COPY server/package.json server/package-lock.json* server/
RUN cd server && npm install --omit=dev

# 앱 복사
COPY . .

# 데이터 디렉토리 (persistent volume 마운트 포인트)
RUN mkdir -p /app/server/data

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "server/index.js"]
