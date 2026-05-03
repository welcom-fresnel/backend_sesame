import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';
import type { Alert } from '../types/index.js';

const router = Router();

// Get all alerts (admin only)
router.get(
  '/',
  authMiddleware,
  requireRole('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const alerts = await query<Alert>(
        `SELECT * FROM alerts ORDER BY created_at DESC`
      );

      res.json({
        success: true,
        data: alerts,
      });
    } catch (error) {
      console.error('Get alerts error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get user's alerts
router.get(
  '/user/me',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      let alerts: Alert[] = [];

      if (req.user.role === 'professor') {
        // Get professor's alerts (alerts they created)
        const professor = await queryOne<{ id: string }>(
          'SELECT id FROM professors WHERE user_id = $1',
          [req.user.id]
        );

        if (professor) {
          alerts = await query<Alert>(
            `SELECT * FROM alerts WHERE professor_id = $1 ORDER BY created_at DESC`,
            [professor.id]
          );
        }
      } else if (req.user.role === 'student') {
        // Get student's alerts (alerts about them)
        const student = await queryOne<{ id: string }>(
          'SELECT id FROM students WHERE user_id = $1',
          [req.user.id]
        );

        if (student) {
          alerts = await query<Alert>(
            `SELECT * FROM alerts WHERE student_id = $1 ORDER BY created_at DESC`,
            [student.id]
          );
        }
      }

      res.json({
        success: true,
        data: alerts,
      });
    } catch (error) {
      console.error('Get user alerts error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Create alert (professor only)
router.post(
  '/',
  authMiddleware,
  requireRole('professor'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { student_id, title, description, severity } = req.body;

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

      const alert = await queryOne<Alert>(
        `INSERT INTO alerts (professor_id, student_id, title, description, severity, is_read)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING *`,
        [professor.id, student_id, title, description, severity || 'medium']
      );

      // Emit WebSocket event for real-time notification
      socketEmitter.notifyUser(student_id, 'alert:new', alert);

      res.status(201).json({
        success: true,
        data: alert,
      });
    } catch (error) {
      console.error('Create alert error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Mark alert as read
router.patch(
  '/:alertId/read',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { alertId } = req.params;

      const alert = await queryOne<Alert>(
        `UPDATE alerts SET is_read = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [alertId]
      );

      if (!alert) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      res.json({
        success: true,
        data: alert,
      });
    } catch (error) {
      console.error('Mark alert as read error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Delete alert (professor or admin)
router.delete(
  '/:alertId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { alertId } = req.params;

      const alert = await queryOne<Alert>(
        'SELECT * FROM alerts WHERE id = $1',
        [alertId]
      );

      if (!alert) {
        res.status(404).json({
          success: false,
          error: 'Alert not found',
        });
        return;
      }

      // Check permissions
      if (req.user?.role !== 'admin') {
        // Check if professor owns this alert
        const professor = await queryOne<{ id: string }>(
          'SELECT id FROM professors WHERE user_id = $1',
          [req.user?.id]
        );

        if (!professor || professor.id !== alert.professor_id) {
          res.status(403).json({
            success: false,
            error: 'Forbidden',
          });
          return;
        }
      }

      await queryOne(
        'DELETE FROM alerts WHERE id = $1 RETURNING id',
        [alertId]
      );

      res.json({
        success: true,
        message: 'Alert deleted successfully',
      });
    } catch (error) {
      console.error('Delete alert error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

export default router;
