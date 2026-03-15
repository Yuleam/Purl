/**
 * Purl API Server
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db');
const { authMiddleware } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const fiberRoutes = require('./routes/fibers');
const linkRoutes = require('./routes/links');
const encounterRoutes = require('./routes/encounters');
const peripheryRoutes = require('./routes/periphery');
const trailRoutes = require('./routes/trail');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: 로컬 개발 + 프로덕션 + 확장 프로그램
const ALLOWED_ORIGINS = [
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:5501', 'http://127.0.0.1:5501',
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:3001', 'http://127.0.0.1:3001'
];

// 환경변수로 추가 origin 허용 (쉼표 구분)
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(o => ALLOWED_ORIGINS.push(o.trim()));
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    if (origin && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    if (origin && origin.endsWith('.ngrok-free.app')) {
      return callback(null, true);
    }
    if (origin && (origin.endsWith('.railway.app') || origin.endsWith('.onrender.com'))) {
      return callback(null, true);
    }
    // 프로덕션: 같은 origin에서 서빙되는 정적 파일 (origin 없음 → 이미 위에서 처리)
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 정적 파일 서빙 (프로젝트 루트)
app.use(express.static(path.join(__dirname, '..')));

// 공개 라우트
app.use('/api/auth', authRoutes);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// 인증 필요 라우트
app.use('/api/fibers', authMiddleware, fiberRoutes);
app.use('/api/links', authMiddleware, linkRoutes);
app.use('/api/encounter', authMiddleware, encounterRoutes);
app.use('/api/periphery', authMiddleware, peripheryRoutes);
app.use('/api/trail', authMiddleware, trailRoutes);

// /api/fibers/:id/links → links 라우터로 포워딩
app.get('/api/fibers/:id/links', authMiddleware, (req, res, next) => {
  req.query.fiber_id = req.params.id;
  req.url = '/';
  linkRoutes(req, res, next);
});

async function start() {
  initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Purl API running on http://localhost:${PORT}`);
  });

  // 임베딩 모델 로드 (서버 응답과 독립적으로 백그라운드 처리)
  try {
    const { initEmbedder } = require('./services/embedder');
    const { backfillEmbeddings, backfillReplyEmbeddings } = require('./services/hint');
    initEmbedder()
      .then(() => backfillEmbeddings())
      .then(() => backfillReplyEmbeddings())
      .catch(err => console.warn('[embedder] 초기화 건너뜀:', err.message));
  } catch (e) {
    // embedder 없어도 서버 동작
  }
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
