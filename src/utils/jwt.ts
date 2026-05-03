import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { JWTPayload } from '../types/index.js';

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, config.jwt.secret) as JWTPayload;
}

export function generateTokenPair(payload: JWTPayload) {
  const accessToken = generateToken(payload);
  const refreshToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: '7d',
  });
  return { accessToken, refreshToken };
}
