import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { config } from './config';
import { initRealtime } from './lib/realtime';
import authRoutes from './routes/auth';
import chatRoutes from './routes/chat';
import cfbdRoutes from './routes/cfbd';
import draftRoutes from './routes/draft';
import usersRoutes from './routes/users';

const app = express();

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/draft', draftRoutes);
app.use('/api/chat', chatRoutes);
// CFBD proxy is mounted last at /api so paths mirror the upstream API
// (/api/games, /api/rankings, ...) like v1.
app.use('/api', cfbdRoutes);

const httpServer = createServer(app);
initRealtime(httpServer);

httpServer.listen(config.port, () => {
  console.log(`MBL server listening on http://localhost:${config.port}`);
});
