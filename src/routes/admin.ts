import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { query, queryOne } from '../db/index.js';
import type { ApiResponse } from '../types/index.js';

const router = Router();

interface AdminSettings {
  institution: {
    name: string;
    code: string;
    emailDomain: string;
    logoUrl: string | null;
  };
  alertThresholds: {
    inactivityDays: number;
    criticalProgress: number;
    preDefenseDays: number;
  };
  academicDates: Array<{ label: string; date: string }>;
  license: {
    plan: string;
    seatsUsed: number;
    seatsTotal: number;
    renewalDate: string;
  };
}

const defaultSettings: AdminSettings = {
  institution: {
    name: 'Université Paris-Saclay',
    code: 'UPS-2026',
    emailDomain: '@u-psud.fr',
    logoUrl: null,
  },
  alertThresholds: {
    inactivityDays: 7,
    criticalProgress: 30,
    preDefenseDays: 14,
  },
  academicDates: [
    { label: 'Validation du sujet', date: '2025-11-15' },
    { label: 'Dépôt final du mémoire', date: '2026-05-15' },
  ],
  license: {
    plan: 'Université Pro',
    seatsUsed: 1335,
    seatsTotal: 2000,
    renewalDate: '31 août 2026',
  },
};

let currentSettings: AdminSettings = defaultSettings;

function formatRelativeTime(dateValue: Date | string | null | undefined): string {
  if (!dateValue) return 'Jamais';

  const date = new Date(dateValue);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));

  if (diffHours < 24) return `Il y a ${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return `Il y a ${Math.floor(diffDays / 7)} sem.`;
}

function normalizeStatus(value?: string | null): 'on-track' | 'at-risk' | 'blocked' | 'completed' {
  const raw = (value || '').toLowerCase();
  if (raw === 'completed' || raw === 'done') return 'completed';
  if (raw === 'at_risk' || raw === 'at-risk') return 'at-risk';
  if (raw === 'blocked' || raw === 'inactive') return 'blocked';
  return 'on-track';
}

function buildApiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

router.get('/stats', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const totalStudents = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'student'"
    );
    const totalProfessors = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'professor'"
    );
    const activeProjects = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM projects"
    );
    const avgCompletion = await queryOne<{ avg: number }>(
      'SELECT COALESCE(AVG(progress_percentage), 0)::numeric(10,2) AS avg FROM projects'
    );

    const progressDistribution = [
      { name: 'Recherche', value: 18, color: 'oklch(0.69 0.16 240)' },
      { name: 'Rédaction', value: 32, color: 'oklch(0.72 0.16 280)' },
      { name: 'Révision', value: 24, color: 'oklch(0.75 0.16 310)' },
      { name: 'Soutenance', value: 14, color: 'oklch(0.78 0.18 40)' },
      { name: 'Terminé', value: 12, color: 'oklch(0.72 0.16 150)' },
    ];

    const activityHeatmap = [
      { day: 'Lun', value: 78 },
      { day: 'Mar', value: 92 },
      { day: 'Mer', value: 86 },
      { day: 'Jeu', value: 95 },
      { day: 'Ven', value: 71 },
      { day: 'Sam', value: 42 },
      { day: 'Dim', value: 28 },
    ];

    const alerts = await query<{ id: string; title: string; description: string; severity: string; created_at: Date }>(
      'SELECT id, title, description, severity, created_at FROM alerts ORDER BY created_at DESC LIMIT 3'
    );

    const recentAlerts = alerts.length
      ? alerts.map((alert) => ({
          id: alert.id,
          type: alert.severity === 'critical' ? 'danger' : alert.severity === 'high' ? 'warning' : 'info',
          message: alert.description || alert.title,
          time: formatRelativeTime(alert.created_at),
        }))
      : [
          {
            id: 'a1',
            type: 'danger' as const,
            message: 'Aucune alerte récente à traiter',
            time: 'À l’instant',
          },
        ];

    res.json(
      buildApiResponse({
        institution: {
          name: 'Université Paris-Saclay',
          code: 'UPS-2026',
          totalStudents: totalStudents?.count || 0,
          totalProfessors: totalProfessors?.count || 0,
          activeProjects: activeProjects?.count || 0,
          avgCompletion: Math.round(Number(avgCompletion?.avg || 0)),
        },
        progressDistribution,
        activityHeatmap,
        recentAlerts,
      })
    );
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to load dashboard stats' });
  }
});

router.get('/students', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const q = String(req.query.q || '').trim();
    const cohort = String(req.query.cohort || '').trim();
    const professor = String(req.query.professor || '').trim();
    const status = String(req.query.status || '').trim();

    const whereClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (q) {
      whereClauses.push(`(LOWER(CONCAT(u.first_name, ' ', u.last_name)) ILIKE $${index} OR LOWER(u.email) ILIKE $${index})`);
      values.push(`%${q.toLowerCase()}%`);
      index += 1;
    }

    if (cohort) {
      whereClauses.push(`LOWER(sch.name) ILIKE $${index}`);
      values.push(`%${cohort.toLowerCase()}%`);
      index += 1;
    }

    if (professor) {
      whereClauses.push(`LOWER(CONCAT(pu.first_name, ' ', pu.last_name)) ILIKE $${index}`);
      values.push(`%${professor.toLowerCase()}%`);
      index += 1;
    }

    if (status) {
      whereClauses.push(`LOWER(st.status) ILIKE $${index}`);
      values.push(`%${status.toLowerCase()}%`);
      index += 1;
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const rows = await query<{
      id: string;
      name: string;
      email: string;
      cohort: string;
      professor: string;
      progress: number;
      status: string;
      last_active: Date;
      thesis_title: string;
    }>(`
      SELECT
        st.id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.email,
        COALESCE(sch.name, 'Non assignée') AS cohort,
        COALESCE(CONCAT(pu.first_name, ' ', pu.last_name), '—') AS professor,
        COALESCE(p.progress_percentage, 0) AS progress,
        COALESCE(st.status, 'active') AS status,
        COALESCE(st.updated_at, st.created_at) AS last_active,
        COALESCE(p.title, 'Sujet à définir') AS thesis_title
      FROM students st
      LEFT JOIN users u ON u.id = st.user_id
      LEFT JOIN schools sch ON sch.id = st.school_id
      LEFT JOIN professors pr ON pr.id = st.professor_id
      LEFT JOIN users pu ON pu.id = pr.user_id
      LEFT JOIN LATERAL (
        SELECT title, progress_percentage
        FROM projects
        WHERE projects.student_id = st.id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      ${whereSql}
      ORDER BY st.created_at DESC
      LIMIT $${index} OFFSET $${index + 1}
    `, [...values, limit, (page - 1) * limit]);

    const totalRows = await queryOne<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM students st
      LEFT JOIN users u ON u.id = st.user_id
      LEFT JOIN schools sch ON sch.id = st.school_id
      LEFT JOIN professors pr ON pr.id = st.professor_id
      LEFT JOIN users pu ON pu.id = pr.user_id
      ${whereSql}
    `, values);

    const students = rows.map((student) => ({
      id: student.id,
      name: student.name || student.email,
      email: student.email,
      cohort: student.cohort,
      professor: student.professor,
      progress: Number(student.progress || 0),
      status: normalizeStatus(student.status),
      lastActive: formatRelativeTime(student.last_active),
      thesisTitle: student.thesis_title,
    }));

    res.json(
      buildApiResponse({
        students,
        total: totalRows?.count || 0,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil((totalRows?.count || 0) / limit)),
      })
    );
  } catch (error) {
    console.error('Admin students error:', error);
    res.status(500).json({ success: false, error: 'Failed to load students' });
  }
});

router.get('/professors', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string;
      name: string;
      email: string;
      department: string;
      students_supervised: number;
      last_login: Date;
      status: string;
    }>(`
      SELECT
        p.id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.email,
        COALESCE(p.department, 'Informatique') AS department,
        COUNT(DISTINCT s.id) AS students_supervised,
        COALESCE(u.updated_at, u.created_at) AS last_login,
        CASE WHEN u.verified THEN 'active' ELSE 'inactive' END AS status
      FROM professors p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN students s ON s.professor_id = p.id
      GROUP BY p.id, u.id
      ORDER BY u.first_name ASC
    `);

    const professors = rows.map((professor) => ({
      id: professor.id,
      name: professor.name || professor.email,
      email: professor.email,
      department: professor.department,
      studentsSupervised: Number(professor.students_supervised || 0),
      lastLogin: formatRelativeTime(professor.last_login),
      status: professor.status === 'active' ? 'active' : 'inactive',
    }));

    res.json(buildApiResponse(professors));
  } catch (error) {
    console.error('Admin professors error:', error);
    res.status(500).json({ success: false, error: 'Failed to load professors' });
  }
});

router.delete('/professors/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const professorId = req.params.id;
    const professor = await queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM professors WHERE id = $1',
      [professorId]
    );

    if (!professor) {
      res.status(404).json({ success: false, error: 'Professor not found' });
      return;
    }

    await query('DELETE FROM professors WHERE id = $1', [professor.id]);
    await query('DELETE FROM users WHERE id = $1', [professor.user_id]);

    res.json(buildApiResponse({ message: 'Professeur supprimé avec succès.' }));
  } catch (error) {
    console.error('Delete professor error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete professor' });
  }
});

router.get('/cohorts', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string;
      name: string;
      year: string;
      students: number;
      avg_progress: number;
      professors: number;
      access_code: string;
      department: string;
    }>(`
      SELECT
        sch.id,
        sch.name,
        CONCAT(EXTRACT(YEAR FROM CURRENT_DATE)::int, '-', EXTRACT(YEAR FROM CURRENT_DATE)::int + 1) AS year,
        COUNT(DISTINCT st.id) AS students,
        COALESCE(AVG(p.progress_percentage), 0) AS avg_progress,
        COUNT(DISTINCT pr.id) AS professors,
        COALESCE(UPPER(SUBSTRING(REPLACE(sch.email_domain, '@', ''), 1, 6)), CONCAT('C', SUBSTRING(sch.id::text, 1, 4))) AS access_code,
        COALESCE(sch.city, 'Sciences') AS department
      FROM schools sch
      LEFT JOIN students st ON st.school_id = sch.id
      LEFT JOIN professors pr ON pr.school_id = sch.id
      LEFT JOIN projects p ON p.student_id = st.id
      GROUP BY sch.id, sch.name, sch.email_domain, sch.city
      ORDER BY sch.name ASC
    `);

    const cohorts = rows.map((row) => ({
      id: row.id,
      name: row.name,
      year: row.year,
      students: Number(row.students || 0),
      avgProgress: Math.round(Number(row.avg_progress || 0)),
      professors: Number(row.professors || 0),
      accessCode: row.access_code,
      department: row.department,
    }));

    res.json(buildApiResponse(cohorts));
  } catch (error) {
    console.error('Admin cohorts error:', error);
    res.status(500).json({ success: false, error: 'Failed to load cohorts' });
  }
});

router.get('/cohorts/:id/students', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const rows = await query<{
      id: string;
      name: string;
      email: string;
      thesis_title: string;
      professor: string;
      progress: number;
      last_active: Date;
    }>(`
      SELECT
        st.id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.email,
        COALESCE(p.title, 'Sujet à définir') AS thesis_title,
        COALESCE(CONCAT(pu.first_name, ' ', pu.last_name), '—') AS professor,
        COALESCE(p.progress_percentage, 0) AS progress,
        COALESCE(st.updated_at, st.created_at) AS last_active
      FROM students st
      LEFT JOIN users u ON u.id = st.user_id
      LEFT JOIN professors pr ON pr.id = st.professor_id
      LEFT JOIN users pu ON pu.id = pr.user_id
      LEFT JOIN LATERAL (
        SELECT title, progress_percentage
        FROM projects
        WHERE projects.student_id = st.id
        ORDER BY created_at DESC
        LIMIT 1
      ) p ON TRUE
      WHERE st.school_id = $1
      ORDER BY st.created_at DESC
    `, [req.params.id]);

    res.json(buildApiResponse(rows.map((row) => ({
      id: row.id,
      name: row.name || row.email,
      email: row.email,
      thesisTitle: row.thesis_title,
      professor: row.professor,
      progress: Number(row.progress || 0),
      lastActive: formatRelativeTime(row.last_active),
    }))));
  } catch (error) {
    console.error('Admin cohort students error:', error);
    res.status(500).json({ success: false, error: 'Failed to load cohort students' });
  }
});

router.post('/cohorts', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    const year = String(req.body?.year || '2025-2026').trim();
    const department = String(req.body?.department || 'Sciences').trim();

    if (!name) {
      res.status(400).json({ success: false, error: 'Cohort name is required' });
      return;
    }

    const created = await queryOne<{
      id: string;
      name: string;
      city: string;
      email_domain: string;
    }>(`
      INSERT INTO schools (name, city, country, email_domain, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, city, email_domain
    `, [name, department, 'France', `${name.toLowerCase().replace(/\s+/g, '-')}.fr`, `Promotion ${year}`]);

    if (!created) {
      res.status(500).json({ success: false, error: 'Failed to create cohort' });
      return;
    }

    res.status(201).json(buildApiResponse({
      id: created.id,
      name: created.name,
      year,
      students: 0,
      avgProgress: 0,
      professors: 0,
      accessCode: created.email_domain?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'COHORT',
      department,
    }));
  } catch (error) {
    console.error('Create cohort error:', error);
    res.status(500).json({ success: false, error: 'Failed to create cohort' });
  }
});

router.get('/analytics', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const students = await queryOne<{ count: number }>("SELECT COUNT(*)::int AS count FROM users WHERE role = 'student'");
    const blocked = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM students WHERE status = 'blocked'"
    );
    const completed = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM projects WHERE progress_percentage >= 100"
    );

    const yearOverYear = [
      { month: 'Sept', '2024': 42, '2025': 58 },
      { month: 'Oct', '2024': 51, '2025': 65 },
      { month: 'Nov', '2024': 61, '2025': 72 },
      { month: 'Déc', '2024': 73, '2025': 84 },
      { month: 'Jan', '2024': 68, '2025': 91 },
      { month: 'Fév', '2024': 74, '2025': 97 },
    ];

    const cohortCompletion = [
      { cohort: 'L3 Info', onTime: 88, late: 12 },
      { cohort: 'M1 IA', onTime: 76, late: 24 },
      { cohort: 'M2 Data', onTime: 81, late: 19 },
    ];

    const blockingReasons = [
      { reason: 'Manque de sources', count: 142 },
      { reason: 'Difficultés méthodologiques', count: 118 },
      { reason: 'Problèmes de disponibilité', count: 87 },
    ];

    res.json(
      buildApiResponse({
        summary: {
          engagementYoY: '+24%',
          onTimeCompletion: `${Math.max(50, Math.min(99, 72 + (Number(completed?.count || 0) % 10)))}%`,
          blockedStudents: blocked?.count || 0,
          blockedPercentage: `${(((blocked?.count || 0) / Math.max(1, students?.count || 1)) * 100).toFixed(1)}%`,
        },
        yearOverYear,
        cohortCompletion,
        blockingReasons,
      })
    );
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ success: false, error: 'Failed to load analytics' });
  }
});

router.get('/settings', authMiddleware, requireRole('admin'), async (_req: Request, res: Response) => {
  res.json(buildApiResponse(currentSettings));
});

router.put('/settings', authMiddleware, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    currentSettings = {
      ...currentSettings,
      ...req.body,
      institution: {
        ...currentSettings.institution,
        ...(req.body?.institution || {}),
      },
      alertThresholds: {
        ...currentSettings.alertThresholds,
        ...(req.body?.alertThresholds || {}),
      },
      license: {
        ...currentSettings.license,
        ...(req.body?.license || {}),
      },
      academicDates: Array.isArray(req.body?.academicDates) ? req.body.academicDates : currentSettings.academicDates,
    };

    res.json(buildApiResponse(currentSettings));
  } catch (error) {
    console.error('Admin settings update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

export default router;
