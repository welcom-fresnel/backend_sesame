import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config/index.js';
import { initializePool, startDatabaseKeepAlive, testConnection } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import authEncadreurRoutes from './routes/auth-encadreur.js';
import schoolRoutes from './routes/schools.js';
import studentRoutes from './routes/students.js';
import projectRoutes from './routes/projects.js';
import alertRoutes from './routes/alerts.js';
import adminRoutes from './routes/admin.js';
import { setupSocketHandlers, SocketEmitter } from './socket/handlers.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    // In dev accept any origin to simplify local frontend testing
    origin: config.isDev ? '*' : config.cors.origin,
    credentials: true,
  },
});

// Middleware
// In dev we allow any localhost/127.0.0.1 origin to reduce friction with varying Vite ports.
app.use(
  cors({
    ...config.cors,
    origin: (origin, callback) => {
      // Allow non-browser clients (curl, server-to-server)
      if (!origin) return callback(null, true);

      // In development, allow all origins to reduce friction with various frontends
      if (config.isDev) return callback(null, true);

      const allowed = config.cors.origin;
      if (Array.isArray(allowed) && allowed.includes(origin)) return callback(null, true);

      return callback(new Error('Not allowed by CORS'));
    },
  })
);

// Simple request logger (dev)
if (config.isDev) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const origin = req.headers.origin ?? '-';
      console.log(
        `[http] ${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms origin=${origin}`
      );
    });
    next();
  });
}

const bodyLimit = Math.max(config.upload.maxFileSize, 10 * 1024 * 1024);
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Health check
app.get('/health', (_req: Request, res: Response) => {
  return res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/encadreur', authEncadreurRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/students', authMiddleware, studentRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/alerts', authMiddleware, alertRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);

// Serve uploaded files statically in development or when using local upload backend
if (config.isDev || (config.upload && (config.upload as any).backend === 'local')) {
  const uploadsDir = path.join(process.cwd(), config.upload.uploadDir || 'uploads');
  app.use('/uploads', express.static(uploadsDir));
}

// WebSocket setup
setupSocketHandlers(io);
const socketEmitter = new SocketEmitter(io);

// Export socketEmitter for use in routes
export { socketEmitter };

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof Error && err.name === 'PayloadTooLargeError') {
    res.status(413).json({
      success: false,
      error: 'Request body too large',
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

// Export io for use in routes if needed
export { io };

// Start server
async function startServer() {
  try {
    // Initialize database
    await initializePool();

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Database connection failed');
    }

    startDatabaseKeepAlive();

    // Start HTTP server
    server.listen(config.port, () => {
      console.log(`
╔════════════════════════════════════════════════╗
║  🚀 SESSAME Backend Server Started             ║
║  📍 http://localhost:${config.port}              ║
║  🔌 WebSocket: ws://localhost:${config.port}     ║
║  🌍 CORS: ${config.cors.origin.join(', ')}     ║
║  🗄️  Database: Connected                       ║
╚════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();
