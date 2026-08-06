import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5175',
  /** URL du frontend étudiant (project-companion) — liens d'invitation /join/:token */
  studentFrontendUrl:
    process.env.STUDENT_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174',
  
  database: {
    url: process.env.DATABASE_URL,
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
    credentials: true,
  },
  
  socketIO: {
    port: parseInt(process.env.SOCKET_IO_PORT || '3001', 10),
    cors: (process.env.SOCKET_IO_CORS || 'http://localhost:5173').split(','),
  },
  
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
  },
  
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

// Validate required env vars
if (!config.database.url) {
  throw new Error('DATABASE_URL is required');
}

if (!config.jwt.secret || config.jwt.secret === 'change-me-in-production') {
  console.warn('⚠️ JWT_SECRET is not set properly. Use a strong secret in production!');
}
