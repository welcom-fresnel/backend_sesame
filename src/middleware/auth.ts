import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import type { JWTPayload } from '../types/index.js';
import { config } from '../config/index.js';

// Alias pour l'authentification des encadreurs (même que authMiddleware)
export const authenticateToken = authMiddleware;

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (config.isDev) {
        console.warn(
          `[auth] 401 missing/invalid Authorization header: ${req.method} ${req.originalUrl} origin=${req.headers.origin ?? '-'} ip=${req.ip}`
        );
      }
      res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header',
      });
      return;
    }

    const token = authHeader.substring(7);
    const payload: JWTPayload = verifyToken(token);
    // Normalize payload so the rest of the code can rely on `req.user.id`
    // regardless of whether the token used `id`, `userId`, or `studentId`.
    if (!payload.id && payload.userId) payload.id = payload.userId;
    if (!payload.id && payload.studentId) payload.id = payload.studentId;

    // Also mirror `id` back to `userId`/`studentId` so handlers that expect
    // those specific fields (legacy code) still work.
    if (!payload.userId && payload.id) payload.userId = payload.id;
    if (!payload.studentId && payload.id) payload.studentId = payload.id;

    req.user = payload;

    next();
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      if (config.isDev) {
        console.warn(
          `[auth] 401 token expired: ${req.method} ${req.originalUrl} origin=${req.headers.origin ?? '-'} ip=${req.ip}`
        );
      }
      res.status(401).json({
        success: false,
        error: 'Token expired',
      });
      return;
    }

    if (config.isDev) {
      console.warn(
        `[auth] 401 invalid token: ${req.method} ${req.originalUrl} origin=${req.headers.origin ?? '-'} ip=${req.ip}`,
        error
      );
    }
    res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }
}

export function requireRole(...roles: Array<string | string[]>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const allowedRoles = roles.flat().filter((r): r is string => typeof r === 'string' && r.length > 0);

    if (!req.user) {
      if (config.isDev) {
        console.warn(
          `[auth] 401 requireRole without user: ${req.method} ${req.originalUrl} origin=${req.headers.origin ?? '-'} ip=${req.ip}`
        );
      }
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      if (config.isDev) {
        console.warn(
          `[auth] 403 forbidden: ${req.method} ${req.originalUrl} role=${req.user.role} allowed=${allowedRoles.join(',')} origin=${req.headers.origin ?? '-'} ip=${req.ip}`
        );
      }
      res.status(403).json({
        success: false,
        error: 'Forbidden - insufficient permissions',
      });
      return;
    }

    next();
  };
}

export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload: JWTPayload = verifyToken(token);
      req.user = payload;
    }

    next();
  } catch {
    // If token is invalid, just continue without auth
    next();
  }
}
