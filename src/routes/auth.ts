import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/index.js';
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
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// Register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = registerSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [validatedData.email]
    );

    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'Email already registered',
      });
      return;
    }

    // Hash password
    const password_hash = await hashPassword(validatedData.password);

    // Create user
    const newUser = await queryOne<User>(
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
      await query(
        'INSERT INTO students (user_id, student_number, status) VALUES ($1, $2, $3)',
        [newUser.id, studentNumber, 'active']
      );
    } else if (validatedData.role === 'professor') {
      await query('INSERT INTO professors (user_id, max_students) VALUES ($1, $2)', [
        newUser.id,
        30,
      ]);
    }

    // Generate tokens
    const tokens = generateTokenPair({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    const userResponse: UserResponse = {
      id: newUser.id,
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
    const user = await queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [validatedData.email]
    );

    if (!user) {
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

    // Generate tokens
    const tokens = generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const userResponse: UserResponse = {
      id: user.id,
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
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    const user = await queryOne<User>(
      'SELECT id, email, role, first_name, last_name, avatar_url, created_at, updated_at FROM users WHERE id = $1',
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
