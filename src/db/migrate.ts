import { initializePool, getPool, closePool } from './index.js';

const schema = `
-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table (all roles)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('student', 'professor', 'admin')),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Professors table (must come before students)
CREATE TABLE IF NOT EXISTS professors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department VARCHAR(255),
  title VARCHAR(100),
  email VARCHAR(255),
  expertise TEXT,
  max_students INTEGER DEFAULT 30,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Students table (after professors)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professor_id UUID REFERENCES professors(id) ON DELETE SET NULL,
  student_number VARCHAR(50) UNIQUE NOT NULL,
  enrollment_year INTEGER,
  specialization VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'on_track', 'at_risk', 'completed')),
  inactivity_days INTEGER DEFAULT 0,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes/Cohorts table
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  capacity INTEGER DEFAULT 50,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'review', 'completed')),
  progress_percentage NUMERIC(5,2) DEFAULT 0,
  start_date DATE,
  expected_end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Journal entries table
CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  entry_date DATE NOT NULL,
  sentiment VARCHAR(50) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'concerning')),
  submitted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Defense proposals table
CREATE TABLE IF NOT EXISTS defense_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student_title VARCHAR(255) NOT NULL,
  proposed_date DATE NOT NULL,
  rationale TEXT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rescheduled', 'rejected')),
  supervisor_comment TEXT,
  supervisor_proposed_date DATE,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id UUID NOT NULL REFERENCES professors(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity VARCHAR(50) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(50) DEFAULT 'system' CHECK (type IN ('alert', 'journal', 'project', 'system')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Files/Uploads table
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(100),
  file_size BIGINT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_professor_id ON students(professor_id);
CREATE INDEX IF NOT EXISTS idx_professors_user_id ON professors(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_student_id ON projects(student_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_project_id ON journal_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_defense_proposals_project_id ON defense_proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_professor_id ON alerts(professor_id);
CREATE INDEX IF NOT EXISTS idx_alerts_student_id ON alerts(student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

-- Foreign key constraint for students.professor_id needs professors to exist first
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_professor_id_fkey;
ALTER TABLE students ADD CONSTRAINT students_professor_id_fkey 
  FOREIGN KEY (professor_id) REFERENCES professors(id) ON DELETE SET NULL;
`;

export async function migrate(): Promise<void> {
  // Initialize pool first
  initializePool();
  
  const pool = getPool();
  const client = await pool.connect();

  try {
    console.log('🔄 Running database migrations...');
    await client.query('BEGIN');
    
    // Split schema into individual statements and execute
    const statements = schema
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0);

    for (const statement of statements) {
      await client.query(statement);
    }

    await client.query('COMMIT');
    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migrations if called directly
const isMainModule = import.meta.url.startsWith('file://') && 
  process.argv[1]?.endsWith(import.meta.url.replace('file://', '').replace(/\\/g, '/'));

if (isMainModule || !import.meta.url.includes('node_modules')) {
  // Exec directly if in development
  (async () => {
    try {
      await migrate();
      await closePool();
      process.exit(0);
    } catch (error) {
      console.error('Migration script failed:', error);
      process.exit(1);
    }
  })();
}
