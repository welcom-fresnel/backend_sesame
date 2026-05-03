import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config/index.js';
import { initializePool, testConnection } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import authEncadreurRoutes from './routes/auth-encadreur.js';
import schoolRoutes from './routes/schools.js';
import studentRoutes from './routes/students.js';
import projectRoutes from './routes/projects.js';
import alertRoutes from './routes/alerts.js';
import { setupSocketHandlers, SocketEmitter } from './socket/handlers.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: config.cors.origin,
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

      const allowed = config.cors.origin;
      if (Array.isArray(allowed) && allowed.includes(origin)) return callback(null, true);

      if (
        config.isDev &&
        /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth/encadreur', authEncadreurRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/students', authMiddleware, studentRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/alerts', authMiddleware, alertRoutes);

// WebSocket setup
setupSocketHandlers(io);
const socketEmitter = new SocketEmitter(io);

// Export socketEmitter for use in routes
export { socketEmitter };

// Global error handler
app.use((err: unknown, req: Request, res: Response) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
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
    initializePool();

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Database connection failed');
    }

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
