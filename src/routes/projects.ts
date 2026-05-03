import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';
import type { Project, JournalEntry } from '../types/index.js';

const router = Router();

// Get all projects (admin only)
router.get(
  '/',
  authMiddleware,
  requireRole('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const projects = await query<Project>(
        `SELECT p.* FROM projects p
         ORDER BY p.created_at DESC`
      );

      res.json({
        success: true,
        data: projects,
      });
    } catch (error) {
      console.error('Get projects error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Create project (student)
router.post(
  '/',
  authMiddleware,
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { title, description, start_date, expected_end_date } = req.body;

      // Get student ID from user_id
      const student = await queryOne<{ id: string }>(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );

      if (!student) {
        res.status(404).json({
          success: false,
          error: 'Student profile not found',
        });
        return;
      }

      const project = await queryOne<Project>(
        `INSERT INTO projects (student_id, title, description, start_date, expected_end_date, status, progress_percentage)
         VALUES ($1, $2, $3, $4, $5, 'planning', 0)
         RETURNING *`,
        [student.id, title, description, start_date, expected_end_date]
      );

      // Notify professor about new project
      socketEmitter.notifyProfessors('project:new', project);

      res.status(201).json({
        success: true,
        data: project,
      });
    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get project by ID
router.get(
  '/:projectId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;

      const project = await queryOne<Project>(
        'SELECT * FROM projects WHERE id = $1',
        [projectId]
      );

      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
        });
        return;
      }

      res.json({
        success: true,
        data: project,
      });
    } catch (error) {
      console.error('Get project error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Update project
router.put(
  '/:projectId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { title, description, status, progress_percentage, expected_end_date } =
        req.body;

      // Check permissions
      const project = await queryOne<Project & { student_id: string }>(
        'SELECT * FROM projects WHERE id = $1',
        [projectId]
      );

      if (!project) {
        res.status(404).json({
          success: false,
          error: 'Project not found',
        });
        return;
      }

      // Get student details
      const student = await queryOne<{ user_id: string; professor_id: string }>(
        'SELECT user_id, professor_id FROM students WHERE id = $1',
        [project.student_id]
      );

      if (
        req.user?.role !== 'admin' &&
        req.user?.id !== student?.user_id &&
        req.user?.id !== student?.professor_id
      ) {
        res.status(403).json({
          success: false,
          error: 'Forbidden',
        });
        return;
      }

      const updated = await queryOne<Project>(
        `UPDATE projects SET 
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         progress_percentage = COALESCE($4, progress_percentage),
         expected_end_date = COALESCE($5, expected_end_date),
         updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [title, description, status, progress_percentage, expected_end_date, projectId]
      );

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error('Update project error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Get journal entries for project
router.get(
  '/:projectId/journal',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;

      const entries = await query<JournalEntry>(
        `SELECT * FROM journal_entries WHERE project_id = $1 ORDER BY entry_date DESC`,
        [projectId]
      );

      res.json({
        success: true,
        data: entries,
      });
    } catch (error) {
      console.error('Get journal entries error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// Create journal entry
router.post(
  '/:projectId/journal',
  authMiddleware,
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { content, entry_date, sentiment } = req.body;

      const entry = await queryOne<JournalEntry>(
        `INSERT INTO journal_entries (project_id, content, entry_date, sentiment, submitted)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [projectId, content, entry_date, sentiment || 'neutral']
      );

      // Notify professor about new journal entry
      socketEmitter.notifyProject(projectId, 'journal:submitted', entry);

      res.status(201).json({
        success: true,
        data: entry,
      });
    } catch (error) {
      console.error('Create journal entry error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

export default router;
