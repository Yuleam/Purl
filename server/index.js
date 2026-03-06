/**
 * Sense Point API Server
 */
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');
const { initEmbedder } = require('./services/embedder');
const { backfillEmbeddings, backfillReplyEmbeddings } = require('./services/hint');
const fiberRoutes = require('./routes/fibers');
const stitchRoutes = require('./routes/stitches');
const knotRoutes = require('./routes/knots');
const noteRoutes = require('./routes/notes');

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:5501', 'http://127.0.0.1:5501',
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:3000', 'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // origin이 없는 경우(같은 출처, curl 등)나 허용 목록에 있는 경우 허용
    // file:// 프로토콜(origin === 'null')은 NODE_ENV=development 일 때만 허용
    if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    if (origin === 'null' && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

app.use('/api/fibers', fiberRoutes);
app.use('/api/stitches', stitchRoutes);
app.use('/api/knots', knotRoutes);
app.use('/api/notes', noteRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Sense Point API running on http://localhost:${PORT}`);
  });

  // 임베딩 모델 로드 (서버 응답과 독립적으로 백그라운드 처리)
  initEmbedder()
    .then(() => backfillEmbeddings())
    .then(() => backfillReplyEmbeddings())
    .catch(err => console.error('[embedder] 초기화 실패:', err.message));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
