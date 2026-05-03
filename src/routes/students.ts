import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import type { Student, User } from '../types/index.js';

const router = Router();

// Get all students (admin only)
router.get(
  '/',
  authMiddleware,
  requireRole('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const students = await query<Student & { user: User }>(
        `SELECT s.*, u.email, u.first_name, u.last_name, u.avatar_url
         FROM students s
         JOIN users u ON s.user_id = u.id
         ORDER BY s.created_at DESC`
      );

      res.json({
        success: true,
        data: students,
      });
    } catch (error) {
      console.error('Get students error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get student by ID (self or professor or admin)
router.get(
  '/:studentId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;

      const student = await queryOne<Student & { user: User; professor?: { id: string } }>(
        `SELECT s.*, u.email, u.first_name, u.last_name, u.avatar_url
         FROM students s
         JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [studentId]
      );

      if (!student) {
        res.status(404).json({
          success: false,
          error: 'Student not found',
        });
        return;
      }

      // Check permissions: can only view if admin, professor of student, or self
      if (
        req.user?.role !== 'admin' &&
        req.user?.id !== student.user_id &&
        req.user?.id !== student.professor_id
      ) {
        res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
        return;
      }

      res.json({
        success: true,
        data: student,
      });
    } catch (error) {
      console.error('Get student error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get student's projects
router.get(
  '/:studentId/projects',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;

      // Verify student exists
      const student = await queryOne<Student>(
        'SELECT id FROM students WHERE id = $1',
        [studentId]
      );

      if (!student) {
        res.status(404).json({
          success: false,
          error: 'Student not found',
        });
        return;
      }

      const projects = await query(
        `SELECT * FROM projects WHERE student_id = $1 ORDER BY created_at DESC`,
        [studentId]
      );

      res.json({
        success: true,
        data: projects,
      });
    } catch (error) {
      console.error('Get student projects error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get professor's students
router.get(
  '/professor/students',
  authMiddleware,
  requireRole('professor'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Get professor ID from user_id
      const professor = await queryOne<{ id: string }>(
        'SELECT id FROM professors WHERE user_id = $1',
        [req.user.id]
      );

      if (!professor) {
        res.status(404).json({
          success: false,
          error: 'Professor profile not found',
        });
        return;
      }

      const students = await query(
        `SELECT s.*, u.email, u.first_name, u.last_name, u.avatar_url
         FROM students s
         JOIN users u ON s.user_id = u.id
         WHERE s.professor_id = $1
         ORDER BY s.created_at DESC`,
        [professor.id]
      );

      res.json({
        success: true,
        data: students,
      });
    } catch (error) {
      console.error('Get professor students error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Update student
router.put(
  '/:studentId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const { status, specialization } = req.body;

      // Check permissions
      const student = await queryOne<Student>(
        'SELECT user_id FROM students WHERE id = $1',
        [studentId]
      );

      if (!student) {
        res.status(404).json({
          success: false,
          error: 'Student not found',
        });
        return;
      }

      if (
        req.user?.role !== 'admin' &&
        req.user?.id !== student.user_id
      ) {
        res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
        return;
      }

      const updated = await queryOne<Student>(
        `UPDATE students SET status = COALESCE($1, status), specialization = COALESCE($2, specialization), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
        [status, specialization, studentId]
      );

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error('Update student error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

export default router;
