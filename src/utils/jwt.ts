import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { JWTPayload } from '../types/index.js';

const jwtSecret = config.jwt.secret as string;

function normalizeJwtPayload(payload: JWTPayload | Record<string, unknown>): JWTPayload {
  const anyPayload = payload as Record<string, unknown>;
  const normalized: JWTPayload = {
    ...anyPayload,
    id: (anyPayload.id as string | undefined) ?? (anyPayload.userId as string | undefined) ?? (anyPayload.studentId as string | undefined),
    userId: (anyPayload.userId as string | undefined) ?? (anyPayload.id as string | undefined) ?? (anyPayload.studentId as string | undefined),
    studentId: (anyPayload.studentId as string | undefined) ?? (anyPayload.id as string | undefined) ?? (anyPayload.userId as string | undefined),
    school_id: (anyPayload.school_id as string | undefined) ?? (anyPayload.schoolId as string | undefined) ?? (anyPayload.school as string | undefined),
    email: anyPayload.email as string,
    role: anyPayload.role as JWTPayload['role'],
  };

  if (!normalized.userId && normalized.id) {
    normalized.userId = normalized.id;
  }
  if (!normalized.studentId && normalized.id) {
    normalized.studentId = normalized.id;
  }
  if (!normalized.school_id) {
    normalized.school_id = (anyPayload.schoolId as string | undefined) ?? (anyPayload.school as string | undefined);
  }

  return normalized;
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(normalizeJwtPayload(payload), jwtSecret, {
    expiresIn: config.jwt.expiresIn as import('ms').StringValue,
  });
}

export function verifyToken(token: string): JWTPayload {
  return normalizeJwtPayload(jwt.verify(token, jwtSecret) as JWTPayload);
}

export function generateTokenPair(payload: JWTPayload) {
  const normalizedPayload = normalizeJwtPayload(payload);
  const accessToken = jwt.sign(normalizedPayload, jwtSecret, {
    expiresIn: config.jwt.expiresIn as import('ms').StringValue,
  });
  const refreshToken = jwt.sign(normalizedPayload, jwtSecret, {
    expiresIn: '7d' as import('ms').StringValue,
  });
  return { accessToken, refreshToken };
}
