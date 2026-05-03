import { query, queryOne, initializePool, testConnection } from './index.js';
import bcryptjs from 'bcryptjs';

const seedDatabase = async () => {
  try {
    // Initialize database connection first
    initializePool();
    
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
    const professor = await queryOne(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email`,
      ['prof.martin@university.fr', professorPassword, 'Martin', 'Dupont', 'professor']
    );

    // Create professor profile
    const professorProfile = await queryOne(
      `INSERT INTO professors (user_id, title, department, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id`,
      [professor.id, 'Professeur Agrégé', 'Informatique', 'prof.martin@university.fr']
    );

    console.log('✅ Professor created:', professor.email);

    // Create students
    const students = [];
    for (let i = 1; i <= 3; i++) {
      const student = await queryOne(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email`,
        [
          `student${i}@university.fr`,
          studentPassword,
          `Student`,
          `${i}`,
          'student'
        ]
      );

      const studentProfile = await queryOne(
        `INSERT INTO students (user_id, student_number, enrollment_year)
         VALUES ($1, $2, $3)
         RETURNING id, user_id`,
        [student.id, `STU${String(i).padStart(5, '0')}`, 2024]
      );

      students.push({
        userId: student.id,
        studentId: studentProfile.id,
        email: student.email,
      });

      console.log(`✅ Student ${i} created:`, student.email);
    }

    // Create admin user
    const admin = await queryOne(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email`,
      ['admin@university.fr', adminPassword, 'Admin', 'System', 'admin']
    );

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
        const entry = await queryOne(
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
      const alert = await queryOne(
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