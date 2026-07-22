import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { queryOne } from '../db/index.js';
import {
  encadreurRegisterSchema,
  encadreurVerifySchema,
  addStudentSchema,
  studentJoinSchema,
} from '../types/schemas.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { generateTokenPair } from '../utils/jwt.js';
import { socketEmitter } from '../index.js';
import { config } from '../config/index.js';

const router = express.Router();

// Fonction d'envoi email (mock pour développement)
async function sendVerificationEmail(email: string, code: string) {
  console.log(`📧 Verification email sent to ${email}: ${code}`);
  // TODO: Intégrer Nodemailer ou service email
}

// POST /api/auth/encadreur/register - Inscription encadreur
router.post('/register', async (req: express.Request, res: express.Response) => {
  try {
    const validatedData = encadreurRegisterSchema.parse(req.body);

    // Vérifier que l'école existe
    const school = await queryOne(
      `SELECT id, email_domain FROM schools WHERE id = $1 AND is_active = true`,
      [validatedData.school_id]
    );

    if (!school) {
      return res.status(400).json({ success: false, error: 'School not found' });
    }

    // Vérifier si l'email existe déjà pour cette école
    const existingUser = await queryOne(
      `SELECT id FROM users WHERE email = $1 AND school_id = $2`,
      [validatedData.email, validatedData.school_id]
    );

    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already registered in this school' });
    }

    // Générer un code de vérification 6 chiffres
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Créer l'utilisateur avec verified=false
    const user = await queryOne(
      `INSERT INTO users (
        school_id, email, first_name, last_name, phone, role, verification_code, verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, first_name, last_name, school_id, role, verified`,
      [
        validatedData.school_id,
        validatedData.email,
        validatedData.first_name,
        validatedData.last_name,
        validatedData.phone || null,
        validatedData.role,
        verificationCode,
        false,
      ]
    );

    // Envoyer email de vérification
    await sendVerificationEmail(validatedData.email, verificationCode);

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for verification code.',
      data: user,
    });
  } catch (error) {
    console.error('Error registering encadreur:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// POST /api/auth/encadreur/verify - Vérifier code et créer mot de passe
router.post('/verify', async (req: express.Request, res: express.Response) => {
  try {
    const validatedData = encadreurVerifySchema.parse(req.body);

    // Trouver l'utilisateur avec ce code de vérification
    const user = await queryOne<{
      id: string;
      school_id: string;
      email: string;
      verification_code: string;
    }>(
      `SELECT id, school_id, email, verification_code FROM users 
       WHERE email = $1 AND verification_code = $2 AND verified = false`,
      [validatedData.email, validatedData.verification_code]
    );

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or verification code' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(validatedData.password, 10);

    // Mettre à jour l'utilisateur
    const updatedUser = await queryOne<{
      id: string;
      school_id: string;
      email: string;
      first_name: string;
      last_name: string;
      role: string;
      verified: boolean;
    }>(
      `UPDATE users 
       SET password_hash = $1, verified = true, verification_code = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, school_id, email, first_name, last_name, role, verified`,
      [passwordHash, user.id]
    );

    if (!updatedUser) {
      return res.status(500).json({ success: false, error: 'Failed to update user' });
    }

    const tokens = generateTokenPair({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role as 'student' | 'professor' | 'admin' | 'encadreur' | 'doc',
      school_id: updatedUser.school_id,
      first_name: updatedUser.first_name,
      last_name: updatedUser.last_name,
    });

    // Notifier que l'encadreur s'est inscrit
    socketEmitter.notifyRole('admin', 'encadreur:registered', { encadreur: updatedUser });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: { user: updatedUser, tokens, token: tokens.accessToken },
    });
  } catch (error) {
    console.error('Error verifying email:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// POST /api/students/add - Encadreur ajoute un étudiant
router.post('/add', authenticateToken, requireRole(['encadreur', 'doc']), async (req: express.Request, res: express.Response) => {
  try {
    const validatedData = addStudentSchema.parse(req.body);
    const encadreur = (req as any).user;

    // Normalize encadreur identity: support payloads with `id` or `userId`.
    const encadreurId = encadreur?.userId ?? encadreur?.id ?? null;
    const schoolId = encadreur?.school_id ?? encadreur?.schoolId ?? encadreur?.school ?? null;

    if (!encadreurId || !schoolId) {
      console.warn('[auth-encadreur] add student missing encadreur identity or school on req.user', encadreur);
      return res.status(401).json({ success: false, error: 'Unauthorized - encadreur identity missing' });
    }

    // Générer un token unique pour cet étudiant
    const joinToken = crypto.randomBytes(16).toString('hex');

    // Créer le lien d'accès étudiant
    const studentLink = await queryOne<{
      id: string;
      join_token: string;
      email: string;
      first_name: string;
      last_name: string;
      created_at: Date;
    }>(
      `INSERT INTO student_join_links (
        school_id, encadreur_id, email, first_name, last_name, join_token
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, join_token, email, first_name, last_name, created_at`,
      [
        schoolId,
        encadreurId,
        validatedData.email,
        validatedData.first_name,
        validatedData.last_name,
        joinToken,
      ]
    );

    if (!studentLink) {
      res.status(500).json({ success: false, error: 'Failed to create invitation link' });
      return;
    }

    // Générer le lien d'accès
    const joinUrl = `${config.frontendUrl}/join/${joinToken}`;

    // TODO: Envoyer email à l'étudiant avec le lien
    console.log(`📧 Student link sent to ${validatedData.email}: ${joinUrl}`);

    // Notifier l'encadreur et l'admin
    socketEmitter.notifyUser(encadreurId, 'student:added', { studentLink });
    socketEmitter.notifyRole('admin', 'student:invited', { studentLink });

    return res.status(201).json({
      success: true,
      message: 'Student added successfully. Invitation link sent.',
      data: { studentLink, joinUrl },
    });
  } catch (error) {
    console.error('Error adding student:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to add student' });
  }
});

// GET /api/students/join/:token - Vérifier le token d'accès (publique)
router.get('/join/:token', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;

    const studentLink = await queryOne<{
      id: string;
      school_id: string;
      email: string;
      first_name: string;
      last_name: string;
      is_used: boolean;
      expires_at: Date;
    }>(
      `SELECT id, school_id, email, first_name, last_name, is_used, expires_at
       FROM student_join_links
       WHERE join_token = $1 AND is_used = false AND expires_at > NOW()`,
      [token]
    );

    if (!studentLink) {
      return res.status(404).json({
        success: false,
        error: 'Link is invalid, expired, or already used',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        valid: true,
        student: {
          email: studentLink.email,
          first_name: studentLink.first_name,
          last_name: studentLink.last_name,
        },
      },
    });
  } catch (error) {
    console.error('Error verifying join token:', error);
    return res.status(500).json({ success: false, error: 'Failed to verify link' });
  }
});

// POST /api/students/join/:token - Étudiant complète son inscription
router.post('/join/:token', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;
    const validatedData = studentJoinSchema.parse(req.body);

    // Trouver le lien d'accès valide
    const studentLink = await queryOne<{
      id: string;
      school_id: string;
      encadreur_id: string;
      email: string;
      first_name: string;
      last_name: string;
      is_used: boolean;
      expires_at: Date;
    }>(
      `SELECT id, school_id, encadreur_id, email, first_name, last_name, is_used, expires_at
       FROM student_join_links
       WHERE join_token = $1 AND is_used = false AND expires_at > NOW()`,
      [token]
    );

    if (!studentLink) {
      return res.status(404).json({
        success: false,
        error: 'Link is invalid, expired, or already used',
      });
    }

    // Vérifier si l'email existe déjà dans users pour cette école
    const existingUser = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 AND school_id = $2`,
      [studentLink.email, studentLink.school_id]
    );

    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Student email already registered' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(validatedData.password, 10);

    // Créer l'utilisateur (profil) dans la table users
    const newUser = await queryOne<{
      id: string;
      school_id: string;
      email: string;
      first_name: string;
      last_name: string;
    }>(
      `INSERT INTO users (school_id, email, password_hash, role, first_name, last_name, verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, school_id, email, first_name, last_name`,
      [
        studentLink.school_id,
        studentLink.email,
        passwordHash,
        'student',
        studentLink.first_name,
        studentLink.last_name,
        true,
      ]
    );

    if (!newUser) {
      res.status(500).json({ success: false, error: 'Failed to create user for student' });
      return;
    }

    // Générer un student_number et créer la ligne students (référence à user_id)
    const studentNumber = `STU-${Date.now()}`;
    const student = await queryOne<{
      id: string;
      user_id: string;
      student_number: string;
      school_id: string;
    }>(
      `INSERT INTO students (user_id, school_id, student_number, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, student_number, school_id`,
      [newUser.id, studentLink.school_id, studentNumber, 'active']
    );

    if (!student) {
      res.status(500).json({ success: false, error: 'Failed to create student profile' });
      return;
    }

    // Marquer le lien comme utilisé
    await queryOne(
      `UPDATE student_join_links SET is_used = true, used_by_student_id = $1
       WHERE id = $2`,
      [student.id, studentLink.id]
    );

    const tokens = generateTokenPair({
      id: newUser.id,
      userId: newUser.id,
      studentId: student.id,
      school_id: newUser.school_id,
      email: newUser.email,
      role: 'student',
      first_name: newUser.first_name,
      last_name: newUser.last_name,
    });

    // Notifier l'encadreur et l'admin
    socketEmitter.notifyUser(studentLink.encadreur_id, 'student:joined', { student });
    socketEmitter.notifyRole('admin', 'student:registered', { student });

    return res.status(201).json({
      success: true,
      message: 'Student registration completed successfully',
      data: { student, tokens, token: tokens.accessToken },
    });
  } catch (error) {
    console.error('Error completing student registration:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

export default router;
