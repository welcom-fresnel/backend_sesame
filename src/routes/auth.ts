import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { hashPassword, comparePasswords } from '../utils/password.js';
import { generateTokenPair } from '../utils/jwt.js';
import type { User, UserResponse } from '../types/index.js';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  first_name: z.string().min(2),
  last_name: z.string().min(2),
  role: z.enum(['student', 'professor', 'admin']),
  school_id: z.string().uuid().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  school_id: z.string().uuid().optional(),
});

// Register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = registerSchema.parse(req.body);

    // Check if user already exists (if school_id provided, check per-school)
    let existingUser: User | null = null;
    if (validatedData.school_id) {
      existingUser = await queryOne<User>(
        'SELECT * FROM users WHERE email = $1 AND school_id = $2',
        [validatedData.email, validatedData.school_id]
      );
    } else {
      existingUser = await queryOne<User>('SELECT * FROM users WHERE email = $1', [validatedData.email]);
    }

    if (existingUser) {
      res.status(400).json({
        success: false,
        error: validatedData.school_id ? 'Email already registered in this school' : 'Email already registered',
      });
      return;
    }

    // Hash password
    const password_hash = await hashPassword(validatedData.password);

    // Create user (include school_id when provided)
    let newUser: User | null = null;
    if (validatedData.school_id) {
      newUser = await queryOne<User>(
        `INSERT INTO users (school_id, email, password_hash, role, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, school_id, email, role, first_name, last_name, avatar_url, created_at, updated_at`,
        [
          validatedData.school_id,
          validatedData.email,
          password_hash,
          validatedData.role,
          validatedData.first_name,
          validatedData.last_name,
        ]
      );
    } else {
      newUser = await queryOne<User>(
        `INSERT INTO users (email, password_hash, role, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, role, first_name, last_name, avatar_url, created_at, updated_at`,
        [
          validatedData.email,
          password_hash,
          validatedData.role,
          validatedData.first_name,
          validatedData.last_name,
        ]
      );
    }

    if (!newUser) {
      res.status(500).json({
        success: false,
        error: 'Failed to create user',
      });
      return;
    }

    // Create role-specific record
    if (validatedData.role === 'student') {
      const studentNumber = `STU-${Date.now()}`;
      if (validatedData.school_id) {
        await query(
          'INSERT INTO students (user_id, school_id, student_number, status) VALUES ($1, $2, $3, $4)',
          [newUser.id, validatedData.school_id, studentNumber, 'active']
        );
      } else {
        await query('INSERT INTO students (user_id, student_number, status) VALUES ($1, $2, $3)', [
          newUser.id,
          studentNumber,
          'active',
        ]);
      }
    } else if (validatedData.role === 'professor') {
      if (validatedData.school_id) {
        await query('INSERT INTO professors (user_id, school_id, max_students) VALUES ($1, $2, $3)', [
          newUser.id,
          validatedData.school_id,
          30,
        ]);
      } else {
        await query('INSERT INTO professors (user_id, max_students) VALUES ($1, $2)', [
          newUser.id,
          30,
        ]);
      }
    }

    // Generate tokens (include school_id when present)
    const tokens = generateTokenPair({
      id: newUser.id,
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
      school_id: (newUser as any).school_id,
      first_name: newUser.first_name,
      last_name: newUser.last_name,
    });

    const userResponse: UserResponse = {
      id: newUser.id,
      school_id: (newUser as any).school_id,
      email: newUser.email,
      role: newUser.role,
      first_name: newUser.first_name,
      last_name: newUser.last_name,
      avatar_url: newUser.avatar_url,
      created_at: newUser.created_at,
      updated_at: newUser.updated_at,
    };

    res.status(201).json({
      success: true,
      data: {
        user: userResponse,
        tokens,
        token: tokens.accessToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      });
      return;
    }

    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = loginSchema.parse(req.body);

    // Find user
    let user: User | null = null;
    if (validatedData.school_id) {
      user = await queryOne<User>('SELECT * FROM users WHERE email = $1 AND school_id = $2', [
        validatedData.email,
        validatedData.school_id,
      ]);
    } else {
      // If multiple accounts exist for the same email (multi-tenant), prefer a verified account
      user = await queryOne<User>(
        'SELECT * FROM users WHERE email = $1 ORDER BY verified DESC LIMIT 1',
        [validatedData.email]
      );
    }

    if (!user || !user.password_hash) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
      return;
    }

    if (user.verified === false && user.role !== 'student') {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
      return;
    }

    // Verify password
    const isPasswordValid = await comparePasswords(
      validatedData.password,
      user.password_hash
    );

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
      return;
    }

    // Generate tokens (include school_id when present)
    const tokens = generateTokenPair({
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      school_id: (user as any).school_id,
      first_name: user.first_name,
      last_name: user.last_name,
    });

    const userResponse: UserResponse = {
      id: user.id,
      school_id: (user as any).school_id,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    res.json({
      success: true,
      data: {
        user: userResponse,
        tokens,
        token: tokens.accessToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.errors,
      });
      return;
    }

    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    const user = await queryOne<User & { student_id?: string; school_id?: string }>(
      `SELECT u.id, u.school_id, u.email, u.role, u.first_name, u.last_name, u.avatar_url,
              u.created_at, u.updated_at, s.id AS student_id
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    const userResponse: UserResponse = {
      id: user.id,
      school_id: user.school_id,
      student_id: user.student_id,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    res.json({
      success: true,
      data: userResponse,
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
