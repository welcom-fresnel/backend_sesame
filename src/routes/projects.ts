import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';
import type { Project, JournalEntry, DefenseProposal, FileRecord } from '../types/index.js';

const router = Router();

type FilePayload = {
  name: string;
  mimeType: string;
  size: number;
  contentBase64: string;
};

async function getProjectAccess(req: Request, projectId: string) {
  const project = await queryOne<Project & { student_id: string }>(
    'SELECT * FROM projects WHERE id = $1',
    [projectId]
  );

  if (!project) {
    return null;
  }

  const student = await queryOne<{ id: string; user_id: string; professor_id?: string; school_id?: string }>(
    'SELECT id, user_id, professor_id, school_id FROM students WHERE id = $1',
    [project.student_id]
  );

  if (!student) {
    return null;
  }

  const user = req.user as any;
  const isAdmin = user?.role === 'admin';
  const isOwner = user?.id === student.user_id;
  const isProfessor = user?.id === student.professor_id;
  const isSchoolEncadreur =
    (user?.role === 'encadreur' || user?.role === 'doc') &&
    Boolean(user?.school_id) &&
    user.school_id === student.school_id;

  if (!isAdmin && !isOwner && !isProfessor && !isSchoolEncadreur) {
    return { project, student, authorized: false };
  }

  return { project, student, authorized: true };
}

// Get all projects (admin only)
router.get(
  '/',
  authMiddleware,
  requireRole('admin'),
  async (_req: Request, res: Response): Promise<void> => {
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

router.get(
  '/me',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const student = await queryOne<{ id: string }>(
        'SELECT id FROM students WHERE user_id = $1',
        [req.user.id]
      );

      if (!student) {
        res.status(404).json({ success: false, error: 'Student profile not found' });
        return;
      }

      let project = await queryOne<Project>(
        'SELECT * FROM projects WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1',
        [student.id]
      );

      if (!project) {
        const fallbackTitle = `Projet de ${req.user?.first_name || 'Étudiant'}`;
        const createdProject = await queryOne<Project>(
          `INSERT INTO projects (student_id, title, description, start_date, expected_end_date, status, progress_percentage)
           VALUES ($1, $2, $3, $4, $5, 'planning', 0)
           RETURNING *`,
          [student.id, fallbackTitle, 'Projet créé automatiquement pour permettre la consultation et la soumission de la proposition de soutenance.', new Date().toISOString(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()]
        );

        if (!createdProject) {
          res.status(500).json({ success: false, error: 'Failed to create fallback project' });
          return;
        }

        project = createdProject;
      }

      const proposal = await queryOne<DefenseProposal>(
        'SELECT * FROM defense_proposals WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [project.id]
      );

      const files = await query<FileRecord>(
        'SELECT * FROM files WHERE project_id = $1 ORDER BY uploaded_at DESC',
        [project.id]
      );

      res.json({
        success: true,
        data: {
          project,
          proposal,
          files,
        },
      });
    } catch (error) {
      console.error('Get my project error:', error);
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
      const access = await getProjectAccess(req, projectId);

      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

      res.json({
        success: true,
        data: access.project,
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
      const { title, description, status, progress_percentage, expected_end_date } = req.body;
      const access = await getProjectAccess(req, projectId);

      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
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

router.get(
  '/:projectId/defense-proposal',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const access = await getProjectAccess(req, projectId);

      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

      const proposal = await queryOne<DefenseProposal>(
        'SELECT * FROM defense_proposals WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
        [projectId]
      );

      const files = await query<FileRecord>(
        'SELECT * FROM files WHERE project_id = $1 ORDER BY uploaded_at DESC',
        [projectId]
      );

      res.json({
        success: true,
        data: {
          project: access.project,
          proposal,
          files,
        },
      });
    } catch (error) {
      console.error('Get defense proposal error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

router.post(
  '/:projectId/defense-proposal',
  authMiddleware,
  requireRole('student'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { title, proposedDate, rationale, files = [] } = req.body as {
        title: string;
        proposedDate: string;
        rationale?: string;
        files?: FilePayload[];
      };

      if (!title || !proposedDate) {
        res.status(400).json({ success: false, error: 'Title and proposed date are required' });
        return;
      }

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

      const proposal = await queryOne<DefenseProposal>(
        `INSERT INTO defense_proposals (project_id, student_title, proposed_date, rationale, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [projectId, title, proposedDate, rationale || null]
      );

      if (proposal) {
        for (const file of files as FilePayload[]) {
          if (!file?.contentBase64 || !file?.name) {
            continue;
          }

          const fileUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${file.contentBase64}`;
          await query(
            `INSERT INTO files (project_id, user_id, file_name, file_url, mime_type, file_size)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [projectId, req.user?.id, file.name, fileUrl, file.mimeType || 'application/octet-stream', file.size || 0]
          );
        }
      }

      socketEmitter.notifyProject(projectId, 'defense:proposal-submitted', proposal);

      res.status(201).json({
        success: true,
        data: proposal,
      });
    } catch (error) {
      console.error('Create defense proposal error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

router.post(
  '/:projectId/defense-proposal/:proposalId/review',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId, proposalId } = req.params;
      const { status, supervisorComment, supervisorProposedDate } = req.body as {
        status: 'validated' | 'rescheduled' | 'rejected';
        supervisorComment?: string;
        supervisorProposedDate?: string;
      };

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

      const updated = await queryOne<DefenseProposal>(
        `UPDATE defense_proposals
         SET status = COALESCE($1, status),
             supervisor_comment = COALESCE($2, supervisor_comment),
             supervisor_proposed_date = COALESCE($3, supervisor_proposed_date),
             reviewed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND project_id = $5
         RETURNING *`,
        [status || 'validated', supervisorComment || null, supervisorProposedDate || null, proposalId, projectId]
      );

      if (!updated) {
        res.status(404).json({ success: false, error: 'Proposal not found' });
        return;
      }

      socketEmitter.notifyProject(projectId, 'defense:proposal-reviewed', updated);

      res.json({
        success: true,
        data: updated,
      });
    } catch (error) {
      console.error('Review defense proposal error:', error);
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

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

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

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({
          success: false,
          error: access ? 'Forbidden' : 'Project not found',
        });
        return;
      }

      const entry = await queryOne<JournalEntry>(
        `INSERT INTO journal_entries (project_id, content, entry_date, sentiment, submitted)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [projectId, content, entry_date, sentiment || 'neutral']
      );

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
