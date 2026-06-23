import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, queryOne } from '../db/index.js';
import {
  encadreurRegisterSchema,
  encadreurVerifySchema,
  addStudentSchema,
  studentJoinSchema,
} from '../types/schemas.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { socketEmitter } from '../index.js';

const router = express.Router();

// Fonction d'envoi email (mock pour développement)
async function sendVerificationEmail(email: string, code: string) {
  console.log(`📧 Verification email sent to ${email}: ${code}`);
  // TODO: Intégrer Nodemailer ou service email
}

// POST /api/auth/encadreur/register - Inscription encadreur
router.post('/register', async (req, res) => {
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

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for verification code.',
      data: user,
    });
  } catch (error) {
    console.error('Error registering encadreur:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  }
});

// POST /api/auth/encadreur/verify - Vérifier code et créer mot de passe
router.post('/verify', async (req, res) => {
  try {
    const validatedData = encadreurVerifySchema.parse(req.body);

    // Trouver l'utilisateur avec ce code de vérification
    const user = await queryOne(
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
    const updatedUser = await queryOne(
      `UPDATE users 
       SET password_hash = $1, verified = true, verification_code = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, school_id, email, first_name, last_name, role, verified`,
      [passwordHash, user.id]
    );

    // Créer le JWT token
    const token = jwt.sign(
      {
        userId: updatedUser.id,
        school_id: updatedUser.school_id,
        email: updatedUser.email,
        role: updatedUser.role,
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Notifier que l'encadreur s'est inscrit
    socketEmitter.notifyRole('admin', 'encadreur:registered', { encadreur: updatedUser });

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: { user: updatedUser, token },
    });
  } catch (error) {
    console.error('Error verifying email:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: 'Verification failed' });
    }
  }
});

// POST /api/students/add - Encadreur ajoute un étudiant
router.post('/add', authenticateToken, requireRole(['encadreur', 'doc']), async (req, res) => {
  try {
    const validatedData = addStudentSchema.parse(req.body);
    const encadreur = (req as any).user;

    // Normalize encadreur identity: support payloads with `id` or `userId`.
    const encadreurId = encadreur?.userId ?? encadreur?.id ?? null;
    const schoolId = encadreur?.school_id ?? encadreur?.schoolId ?? encadreur?.school ?? null;

    if (!encadreurId) {
      console.warn('[auth-encadreur] add student missing encadreur id on req.user', encadreur);
      return res.status(401).json({ success: false, error: 'Unauthorized - encadreur id missing' });
    }

    // Générer un token unique pour cet étudiant
    const joinToken = crypto.randomBytes(16).toString('hex');

    // Créer le lien d'accès étudiant
    const studentLink = await queryOne(
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

    // Générer le lien d'accès
    const joinUrl = `${process.env.FRONTEND_URL || 'http://localhost:8080'}/join/${joinToken}`;

    // TODO: Envoyer email à l'étudiant avec le lien
    console.log(`📧 Student link sent to ${validatedData.email}: ${joinUrl}`);

    // Notifier l'encadreur et l'admin
    socketEmitter.notifyUser(encadreurId, 'student:added', { studentLink });
    socketEmitter.notifyRole('admin', 'student:invited', { studentLink });

    res.status(201).json({
      success: true,
      message: 'Student added successfully. Invitation link sent.',
      data: { studentLink, joinUrl },
    });
  } catch (error) {
    console.error('Error adding student:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: 'Failed to add student' });
    }
  }
});

// GET /api/students/join/:token - Vérifier le token d'accès (publique)
router.get('/join/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const studentLink = await queryOne(
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

    res.json({
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
    res.status(500).json({ success: false, error: 'Failed to verify link' });
  }
});

// POST /api/students/join/:token - Étudiant complète son inscription
router.post('/join/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const validatedData = studentJoinSchema.parse(req.body);

    // Trouver le lien d'accès valide
    const studentLink = await queryOne(
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
    const existingUser = await queryOne(
      `SELECT id FROM users WHERE email = $1 AND school_id = $2`,
      [studentLink.email, studentLink.school_id]
    );

    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Student email already registered' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(validatedData.password, 10);

    // Créer l'utilisateur (profil) dans la table users
    const newUser = await queryOne(
      `INSERT INTO users (school_id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, school_id, email, first_name, last_name`,
      [
        studentLink.school_id,
        studentLink.email,
        passwordHash,
        'student',
        studentLink.first_name,
        studentLink.last_name,
      ]
    );

    if (!newUser) {
      throw new Error('Failed to create user for student');
    }

    // Générer un student_number et créer la ligne students (référence à user_id)
    const studentNumber = `STU-${Date.now()}`;
    const student = await queryOne(
      `INSERT INTO students (user_id, school_id, student_number, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, student_number, school_id`,
      [newUser.id, studentLink.school_id, studentNumber, 'active']
    );

    // Marquer le lien comme utilisé
    await queryOne(
      `UPDATE student_join_links SET is_used = true, used_by_student_id = $1
       WHERE id = $2`,
      [student.id, studentLink.id]
    );

    // Créer JWT token pour l'étudiant (inclut userId et studentId)
    const jwtToken = jwt.sign(
      {
        userId: newUser.id,
        studentId: student.id,
        school_id: newUser.school_id,
        email: newUser.email,
        role: 'student',
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Notifier l'encadreur et l'admin
    socketEmitter.notifyUser(studentLink.encadreur_id, 'student:joined', { student });
    socketEmitter.notifyRole('admin', 'student:registered', { student });

    res.status(201).json({
      success: true,
      message: 'Student registration completed successfully',
      data: { student, token: jwtToken },
    });
  } catch (error) {
    console.error('Error completing student registration:', error);
    if (error instanceof Error && error.message.includes('validation')) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  }
});

export default router;
