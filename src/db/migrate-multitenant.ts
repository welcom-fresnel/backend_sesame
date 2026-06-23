import { initializePool, getPool, closePool } from './index.js';
import { pathToFileURL } from 'url';

const multiTenantSchema = `
-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Table des écoles (Tenant principal)
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  city VARCHAR(255),
  country VARCHAR(255),
  email_domain VARCHAR(255) UNIQUE,  -- exemple: university.fr
  logo_url TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index sur les colonnes fréquemment recherchées
CREATE INDEX IF NOT EXISTS idx_schools_email_domain ON schools(email_domain);
CREATE INDEX IF NOT EXISTS idx_schools_active ON schools(is_active);

-- Modification de la table users existante
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6);
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
-- password_hash must be nullable for 2-step encadreur registration (register → verify email → set password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Extend user roles to support multi-tenant encadreurs/docs
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%IN%';

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c_name);
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('student','professor','admin','encadreur','doc'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  -- Drop constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_user_per_school'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT unique_user_per_school;
  END IF;
  
  -- Drop any global unique constraint on email so the new per-school uniqueness can be applied
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

  -- Create the constraint to enforce uniqueness per school
  ALTER TABLE users ADD CONSTRAINT unique_user_per_school UNIQUE (school_id, email);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_users_school_id ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_verified ON users(verified);

-- Modification de la table professors (si elle existe)
ALTER TABLE professors ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_professors_school_id ON professors(school_id);

-- Ensure a professor can belong to multiple schools by making uniqueness scoped to (school_id, user_id)
DO $$
BEGIN
  -- Drop existing unique constraint on user_id if present
  ALTER TABLE professors DROP CONSTRAINT IF EXISTS professors_user_id_key;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE professors ADD CONSTRAINT unique_professor_per_school UNIQUE (school_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Modification de la table students (si elle existe)
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);

-- Ensure a student can belong to multiple schools by scoping uniqueness to (school_id, user_id)
DO $$
BEGIN
  -- Drop existing unique constraint on user_id if present
  ALTER TABLE students DROP CONSTRAINT IF EXISTS students_user_id_key;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE students ADD CONSTRAINT unique_student_per_school UNIQUE (school_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Nouvelle table: Student Join Links (pour l'invitation des étudiants)
CREATE TABLE IF NOT EXISTS student_join_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  encadreur_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  join_token VARCHAR(32) NOT NULL UNIQUE,  -- token d'accès public
  is_used BOOLEAN DEFAULT FALSE,
  used_by_student_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',
  CONSTRAINT fk_used_by FOREIGN KEY(used_by_student_id) REFERENCES students(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_student_links_token ON student_join_links(join_token);
CREATE INDEX IF NOT EXISTS idx_student_links_school ON student_join_links(school_id);
CREATE INDEX IF NOT EXISTS idx_student_links_encadreur ON student_join_links(encadreur_id);
CREATE INDEX IF NOT EXISTS idx_student_links_unused ON student_join_links(is_used, expires_at);

-- Modification des tables projects, journal_entries, alerts, etc.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_projects_school_id ON projects(school_id);

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_journal_school_id ON journal_entries(school_id);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_alerts_school_id ON alerts(school_id);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_school_id ON notifications(school_id);

-- Vue pour les statistiques par école
CREATE OR REPLACE VIEW school_stats AS
SELECT 
  s.id,
  s.name,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT CASE WHEN u.role = 'student' THEN u.id END) as total_students,
  COUNT(DISTINCT CASE WHEN u.role = 'encadreur' OR u.role = 'doc' THEN u.id END) as total_encadreurs,
  COUNT(DISTINCT p.id) as total_projects,
  COUNT(DISTINCT CASE WHEN je.created_at >= NOW() - INTERVAL '7 days' THEN je.id END) as recent_entries
FROM schools s
LEFT JOIN users u ON s.id = u.school_id
LEFT JOIN projects p ON s.id = p.school_id
LEFT JOIN journal_entries je ON s.id = je.school_id
GROUP BY s.id, s.name;
`;

export async function migrateMultiTenant(): Promise<void> {
  try {
    initializePool();
    const pool = getPool();
    const client = await pool.connect();

    console.log('🔄 Running multi-tenant migrations...');

    await client.query(multiTenantSchema);

    console.log('✅ Multi-tenant schema updated successfully');

    client.release();
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  }
}

// Main execution
const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  (async () => {
    try {
      await migrateMultiTenant();
      await closePool();
      process.exit(0);
    } catch (error) {
      console.error(error);
      await closePool();
      process.exit(1);
    }
  })();
}
