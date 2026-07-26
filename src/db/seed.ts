import { queryOne, initializePool, testConnection } from './index.js';
import bcryptjs from 'bcryptjs';

const seedDatabase = async () => {
  try {
    // Initialize database connection first
    await initializePool();
    
    // Test connection
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }
    
    console.log('🌱 Seeding database...');

    // Hash passwords
    const professorPassword = await bcryptjs.hash('professor123', 10);
    const studentPassword = await bcryptjs.hash('student123', 10);
    const adminPassword = await bcryptjs.hash('admin123', 10);

    // Create professor user
    let professor = await queryOne(
      `SELECT id, email FROM users WHERE email = $1`,
      ['prof.martin@university.fr']
    );

    if (!professor) {
      professor = await queryOne(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, verified)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email`,
        ['prof.martin@university.fr', professorPassword, 'Martin', 'Dupont', 'professor', true]
      );
    } else {
      await queryOne(
        `UPDATE users SET verified = true WHERE id = $1 RETURNING id`,
        [professor.id]
      );
    }

    if (!professor) {
      throw new Error('Failed to create professor user');
    }

    // Create professor profile
    let professorProfile = await queryOne(
      `SELECT id, user_id FROM professors WHERE user_id = $1`,
      [professor.id]
    );

    if (!professorProfile) {
      professorProfile = await queryOne(
        `INSERT INTO professors (user_id, title, department, email)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id`,
        [professor.id, 'Professeur Agrégé', 'Informatique', 'prof.martin@university.fr']
      );
    }

    if (!professorProfile) {
      throw new Error('Failed to create professor profile');
    }

    console.log('✅ Professor created:', professor.email);

    // Create students
    const students = [];
    for (let i = 1; i <= 3; i++) {
      let student = await queryOne(
        `SELECT id, email FROM users WHERE email = $1`,
        [`student${i}@university.fr`]
      );

      if (!student) {
        student = await queryOne(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, verified)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email`,
          [
            `student${i}@university.fr`,
            studentPassword,
            `Student`,
            `${i}`,
            'student',
            true
          ]
        );
      } else {
        await queryOne(
          `UPDATE users SET verified = true WHERE id = $1 RETURNING id`,
          [student.id]
        );
      }

      if (!student) {
        throw new Error(`Failed to create student ${i}`);
      }

      let studentProfile = await queryOne(
        `SELECT id, user_id FROM students WHERE user_id = $1`,
        [student.id]
      );

      if (!studentProfile) {
        studentProfile = await queryOne(
          `INSERT INTO students (user_id, student_number, enrollment_year)
           VALUES ($1, $2, $3)
           RETURNING id, user_id`,
          [student.id, `STU${String(i).padStart(5, '0')}`, 2024]
        );
      }

      if (!studentProfile) {
        throw new Error(`Failed to create student profile for ${student.email}`);
      }

      students.push({
        studentId: studentProfile.id,
        email: student.email,
      });

      console.log(`✅ Student ${i} created:`, student.email);
    }

    // Create admin user
    let admin = await queryOne(
      `SELECT id, email FROM users WHERE email = $1`,
      ['admin@university.fr']
    );

    if (!admin) {
      admin = await queryOne(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, verified)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email`,
        ['admin@university.fr', adminPassword, 'Admin', 'System', 'admin', true]
      );
    } else {
      await queryOne(
        `UPDATE users SET verified = true WHERE id = $1 RETURNING id`,
        [admin.id]
      );
    }

    if (!admin) {
      throw new Error('Failed to create admin user');
    }

    console.log('✅ Admin created:', admin.email);

    // Create projects for students
    const projects = [];
    for (const student of students) {
      const project = await queryOne(
        `INSERT INTO projects (student_id, title, description, status, progress_percentage, start_date, expected_end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title`,
        [
          student.studentId,
          `Mémoire de ${student.email.split('@')[0]}`,
          `Un projet innovant sur l'intelligence artificielle et le machine learning appliqué à l'éducation.`,
          'in_progress',
          35,
          new Date('2024-09-01'),
          new Date('2025-06-30')
        ]
      );

      if (!project) {
        throw new Error(`Failed to create project for ${student.email}`);
      }

      projects.push({
        projectId: project.id,
        studentId: student.studentId,
        title: project.title,
      });

      console.log(`✅ Project created:`, project.title);
    }

    // Create journal entries
    for (const project of projects) {
      for (let i = 1; i <= 2; i++) {
        await queryOne(
          `INSERT INTO journal_entries (project_id, content, entry_date, sentiment, submitted)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            project.projectId,
            `Journal entry ${i} - Progressing well on the research phase. We've completed the literature review and started the implementation.`,
            new Date(Date.now() - (3 - i) * 24 * 60 * 60 * 1000),
            i === 1 ? 'positive' : 'neutral',
            true
          ]
        );

        console.log(`✅ Journal entry created for project ${project.projectId}`);
      }
    }

    // Create alerts
    for (const student of students) {
      await queryOne(
        `INSERT INTO alerts (professor_id, student_id, title, description, severity, is_read)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          professorProfile.id,
          student.studentId,
          'Milestone atteint',
          'Félicitations! Vous avez atteint 25% de progression sur votre projet.',
          'low',
          false
        ]
      );

      console.log(`✅ Alert created for student ${student.email}`);
    }

    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║  🌱 Database Seeded Successfully!      ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Professeur:                           ║');
    console.log(`║    Email: prof.martin@university.fr    ║`);
    console.log(`║    Password: professor123             ║`);
    console.log('║                                        ║');
    console.log('║  Étudiants:                            ║');
    for (let i = 1; i <= 3; i++) {
      console.log(`║    Email: student${i}@university.fr         ║`);
    }
    console.log(`║    Password: student123                ║`);
    console.log('║                                        ║');
    console.log('║  Admin:                                ║');
    console.log(`║    Email: admin@university.fr          ║`);
    console.log(`║    Password: admin123                  ║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();