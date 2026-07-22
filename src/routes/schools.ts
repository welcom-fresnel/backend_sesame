import express from 'express';
import { query, queryOne } from '../db/index.js';
import { createSchoolSchema } from '../types/schemas.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';

const router = express.Router();

// GET /api/schools - Liste toutes les écoles (publique)
router.get('/', async (_req, res) => {
  try {
    const schools = await query(`
      SELECT id, name, city, country, email_domain, logo_url, description
      FROM schools
      WHERE is_active = true
      ORDER BY name ASC
    `);

    return res.json({ success: true, data: schools });
  } catch (error) {
    console.error('Error fetching schools:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch schools' });
  }
});

// GET /api/schools/:id - Détails d'une école spécifique
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const school = await queryOne(`
      SELECT * FROM schools WHERE id = $1 AND is_active = true
    `, [id]);
    
    if (!school) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    // Récupérer les stats de l'école
    const stats = await queryOne(`
      SELECT * FROM school_stats WHERE id = $1
    `, [id]);
    
    return res.status(200).json({ success: true, data: { ...school, stats } });
  } catch (error) {
    console.error('Error fetching school:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch school' });
  }
});

// POST /api/schools - Créer une nouvelle école (Admin seulement)
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const validatedData = createSchoolSchema.parse(req.body);
    
    // Vérifier si l'email_domain existe déjà
    const existingSchool = await queryOne(`
      SELECT id FROM schools WHERE email_domain = $1
    `, [validatedData.email_domain]);
    
    if (existingSchool) {
      return res.status(400).json({ success: false, error: 'Email domain already exists' });
    }
    
    const school = await queryOne(`
      INSERT INTO schools (name, city, country, email_domain, logo_url, description)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, city, country, email_domain, logo_url, description, is_active, created_at
    `, [
      validatedData.name,
      validatedData.city || null,
      validatedData.country || null,
      validatedData.email_domain,
      validatedData.logo_url || null,
      validatedData.description || null
    ]);

    if (!school) {
      return res.status(500).json({ success: false, error: 'Failed to create school' });
    }
    
    socketEmitter.notifyRole('admin', 'school:created', { school });
    
    return res.status(201).json({ success: true, data: school });
  } catch (error) {
    console.error('Error creating school:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to create school' });
  }
});

// PUT /api/schools/:id - Modifier une école (Admin seulement)
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Construire la requête de mise à jour dynamiquement
    const allowedFields = ['name', 'city', 'country', 'logo_url', 'description', 'is_active'];
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;
    
    for (const field of allowedFields) {
      if (field in updates) {
        fields.push(`${field} = $${paramCount}`);
        values.push(updates[field]);
        paramCount++;
      }
    }
    
    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    values.push(id);
    const query_str = `
      UPDATE schools
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const updatedSchool = await queryOne(query_str, values);
    
    if (!updatedSchool) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    socketEmitter.notifyRole('admin', 'school:updated', { school: updatedSchool });
    
    return res.status(200).json({ success: true, data: updatedSchool });
  } catch (error) {
    console.error('Error updating school:', error);
    return res.status(500).json({ success: false, error: 'Failed to update school' });
  }
});

// DELETE /api/schools/:id - Supprimer une école (Admin seulement)
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Soft delete (marquer comme inactive)
    const deletedSchool = await queryOne(`
      UPDATE schools
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, name
    `, [id]);
    
    if (!deletedSchool) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    socketEmitter.notifyRole('admin', 'school:deleted', { school: deletedSchool });
    
    return res.status(200).json({ success: true, data: deletedSchool, message: 'School deleted successfully' });
  } catch (error) {
    console.error('Error deleting school:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete school' });
  }
});

// GET /api/schools/:id/stats - Statistiques d'une école
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    
    // Vérifier si l'utilisateur appartient à cette école (ou est admin)
    if (user.role !== 'admin' && user.school_id !== id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    const stats = await queryOne(`
      SELECT * FROM school_stats WHERE id = $1
    `, [id]);
    
    if (!stats) {
      return res.status(404).json({ success: false, error: 'School not found' });
    }
    
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching school stats:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

export default router;
