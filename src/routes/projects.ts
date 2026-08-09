import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';
import type { Project, JournalEntry, DefenseProposal, FileRecord } from '../types/index.js';
import { config } from '../config/index.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

// Recalculate project progress based on project_steps weights
async function recalculateProjectProgress(projectId: string) {
  // Sum weights and sum completed weights
  const totals = await query<{ total_weight: number | null; completed_weight: number | null }>(
    `SELECT
      SUM(weight) AS total_weight,
      SUM(CASE WHEN completed THEN weight ELSE 0 END) AS completed_weight
     FROM project_steps
     WHERE project_id = $1`,
    [projectId]
  );

  const totalWeight = totals[0]?.total_weight ?? 0;
  const completedWeight = totals[0]?.completed_weight ?? 0;

  let progress = 0;
  if (Number(totalWeight) > 0) {
    progress = Math.round((Number(completedWeight) / Number(totalWeight)) * 100);
  } else {
    // Fallback: if no weights defined, compute by completed count
    const counts = await query<{ total_count: number; completed_count: number }>(
      `SELECT COUNT(*)::int AS total_count, SUM(CASE WHEN completed THEN 1 ELSE 0 END)::int AS completed_count FROM project_steps WHERE project_id = $1`,
      [projectId]
    );
    const totalCount = counts[0]?.total_count ?? 0;
    const completedCount = counts[0]?.completed_count ?? 0;
    progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  }

  // Update projects table
  const updated = await queryOne<Project>(
    `UPDATE projects SET progress_percentage = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [progress, projectId]
  );

  // Emit socket event for project progress update (if any)
  try {
    socketEmitter.notifyProject(projectId, 'project_steps_updated', { projectId, progress_percentage: progress });
  } catch (e) {
    console.warn('Socket emit failed for project_steps_updated', e);
  }

  return updated;
}

const router = Router();

let s3Client: S3Client | null = null;
if (config.upload.s3 && config.upload.s3.bucket) {
  s3Client = new S3Client({ region: config.upload.s3.region, credentials: { accessKeyId: config.upload.s3.accessKeyId, secretAccessKey: config.upload.s3.secretAccessKey } });
}

let cachedSupervisorFkTarget: 'users' | 'professors' | null = null;

async function getSupervisorFkTarget(): Promise<'users' | 'professors' | null> {
  if (cachedSupervisorFkTarget) return cachedSupervisorFkTarget;

  const result = await queryOne<{
    foreign_table_name: string;
  }>(
    `SELECT ccu.table_name AS foreign_table_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_name = 'project_steps'
       AND kcu.column_name = 'supervisor_id'
     LIMIT 1`
  );

  const normalized = result?.foreign_table_name;
  if (normalized === 'users' || normalized === 'professors') {
    cachedSupervisorFkTarget = normalized;
  } else {
    cachedSupervisorFkTarget = 'users';
  }

  return cachedSupervisorFkTarget;
}

async function resolveSupervisorId(user: any): Promise<string | null> {
  if (!user) {
    return null;
  }

  const fkTarget = await getSupervisorFkTarget();
  if (fkTarget === 'professors') {
    if (user.role === 'professor') {
      const professor = await queryOne<{ id: string }>(
        'SELECT id FROM professors WHERE user_id = $1',
        [user.id]
      );
      return professor?.id ?? null;
    }
    return null;
  }

  return user.id || null;
}

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

// Generate a signed upload URL for S3 (frontend will PUT the file directly)
router.post(
  '/uploads/sign',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!s3Client) {
        res.status(400).json({ success: false, error: 'S3 not configured' });
        return;
      }

      const { fileName, contentType: rawContentType, projectId } = req.body as { fileName: string; contentType?: string; projectId?: string };
      const contentType = rawContentType || 'application/octet-stream';
      if (!fileName) {
        res.status(400).json({ success: false, error: 'fileName is required' });
        return;
      }

      const key = `uploads/${projectId ?? 'general'}/${crypto.randomUUID()}_${fileName}`;
      const cmd = new PutObjectCommand({ Bucket: config.upload.s3.bucket, Key: key, ContentType: contentType });
      const url = await getSignedUrl(s3Client!, cmd, { expiresIn: 60 });

      res.json({ success: true, data: { url, key, publicUrl: `https://${config.upload.s3.bucket}.s3.${config.upload.s3.region}.amazonaws.com/${key}` } });
    } catch (error) {
      console.error('Generate signed URL error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
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

// Get steps for a project
router.get(
  '/:projectId/steps',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({ success: false, error: access ? 'Forbidden' : 'Project not found' });
        return;
      }

      const steps = await query(
        'SELECT * FROM project_steps WHERE project_id = $1 ORDER BY created_at ASC',
        [projectId]
      );

      res.json({ success: true, data: steps });
    } catch (error) {
      console.error('Get project steps error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// Create a step (encadreur / professor / admin)
router.post(
  '/:projectId/steps',
  authMiddleware,
  requireRole('encadreur', 'professor', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { title, description, due_date, weight, files = [] } = req.body as any;

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({ success: false, error: access ? 'Forbidden' : 'Project not found' });
        return;
      }

      if (!title) {
        res.status(400).json({ success: false, error: 'Title is required' });
        return;
      }

      const supervisorId = await resolveSupervisorId(req.user);
      const providedFileUrl = (req.body && (req.body.file_url || req.body.fileUrl || req.body.publicUrl)) ?? null;
      const step = await queryOne(
        `INSERT INTO project_steps (project_id, supervisor_id, title, description, due_date, weight, file_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [projectId, supervisorId, title, description || null, due_date || null, weight || 0, providedFileUrl]
      );

      // If files are provided as base64 payloads, store them in files table and attach first file_url
      if (step && Array.isArray(files) && files.length > 0) {
        const f = files[0];
        if (f?.contentBase64 && f?.name) {
          let fileUrl: string;
          if (s3Client) {
            const key = `projects/${projectId}/steps/${step.id}/${crypto.randomUUID()}_${f.name}`;
            const cmd = new PutObjectCommand({
              Bucket: config.upload.s3.bucket,
              Key: key,
              Body: Buffer.from(f.contentBase64, 'base64'),
              ContentType: f.mimeType || 'application/octet-stream',
            });
            await s3Client.send(cmd);
            fileUrl = `https://${config.upload.s3.bucket}.s3.${config.upload.s3.region}.amazonaws.com/${key}`;
          } else {
            fileUrl = `data:${f.mimeType || 'application/octet-stream'};base64,${f.contentBase64}`;
          }

          await query(
            `INSERT INTO files (project_id, user_id, file_name, file_url, mime_type, file_size)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [projectId, req.user?.id, f.name, fileUrl, f.mimeType || null, f.size || 0]
          );
          await query(`UPDATE project_steps SET file_url = $1 WHERE id = $2`, [fileUrl, step.id]);
          step.file_url = fileUrl;
        }
      }

      await recalculateProjectProgress(projectId);

      socketEmitter.notifyProject(projectId, 'project_step:created', step);

      res.status(201).json({ success: true, data: step });
    } catch (error) {
      console.error('Create project step error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// Update a step (toggle completed, edit fields)
router.patch(
  '/:projectId/steps/:stepId',
  authMiddleware,
  requireRole('encadreur', 'professor', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId, stepId } = req.params;
      const { title, description, due_date, weight, completed, file_url, files = [] } = req.body as any;

      const access = await getProjectAccess(req, projectId);
      if (!access || !access.authorized) {
        res.status(access ? 403 : 404).json({ success: false, error: access ? 'Forbidden' : 'Project not found' });
        return;
      }

      let finalFileUrl = file_url || null;
      if (Array.isArray(files) && files.length > 0) {
        const f = files[0];
        const candidateUrl = f?.url || f?.file_url || f?.publicUrl;
        if (candidateUrl) {
          finalFileUrl = candidateUrl;
          await query(
            `INSERT INTO files (project_id, user_id, file_name, file_url, mime_type, file_size)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [projectId, req.user?.id, f.name || candidateUrl.split('/').pop(), candidateUrl, f.mimeType || null, f.size || 0]
          );
        }
      }

      const updated = await queryOne(
        `UPDATE project_steps SET
           title = COALESCE($1, title),
           description = COALESCE($2, description),
           due_date = COALESCE($3, due_date),
           weight = COALESCE($4, weight),
           completed = COALESCE($5, completed),
           file_url = COALESCE($6, file_url),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $7 AND project_id = $8
         RETURNING *`,
        [title || null, description || null, due_date || null, weight ?? null, typeof completed === 'boolean' ? completed : null, finalFileUrl || null, stepId, projectId]
      );

      if (!updated) {
        res.status(404).json({ success: false, error: 'Step not found' });
        return;
      }

      // Recalculate project progress if completed changed or weight changed
      await recalculateProjectProgress(projectId);

      socketEmitter.notifyProject(projectId, 'project_step:updated', updated);

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Update project step error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
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
      const { content, entry_date, sentiment, completed_step_ids = [], files = [] } = req.body;

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

      if (entry) {
        // Attach files sent as base64 payloads to files table
        if (Array.isArray(files) && files.length > 0) {
          for (const f of files) {
            if (!f) continue;
            if (f?.contentBase64 && f?.name) {
              const fileUrl = `data:${f.mimeType || 'application/octet-stream'};base64,${f.contentBase64}`;
              await query(
                `INSERT INTO files (project_id, user_id, file_name, file_url, mime_type, file_size)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [projectId, req.user?.id, f.name, fileUrl, f.mimeType || null, f.size || 0]
              );
            } else if (f?.url || f?.file_url || f?.publicUrl) {
              const fileUrl = f.url || f.file_url || f.publicUrl;
              await query(
                `INSERT INTO files (project_id, user_id, file_name, file_url, mime_type, file_size)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [projectId, req.user?.id, f.name || fileUrl.split('/').pop(), fileUrl, f.mimeType || null, f.size || 0]
              );
            }
          }
        }

        // If the student marked steps as completed in this journal entry
        if (Array.isArray(completed_step_ids) && completed_step_ids.length > 0) {
          const stepIds = completed_step_ids.filter(Boolean);

          for (const stepId of stepIds) {
            // Insert completion link
            try {
              await query(
                `INSERT INTO journal_step_completions (journal_id, step_id) VALUES ($1, $2)`,
                [entry.id, stepId]
              );
            } catch (e) {
              // ignore duplicate/constraint errors
            }
          }

          // Mark steps completed
          await query(
            `UPDATE project_steps SET completed = true, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`,
            [stepIds]
          );

          // Recalculate project progress
          await recalculateProjectProgress(projectId);
        }

        socketEmitter.notifyProject(projectId, 'journal:submitted', entry);
      }

      res.status(201).json({ success: true, data: entry });
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
