// User types
export interface User {
  id: string;
  school_id?: string;
  email: string;
  password_hash: string;
  role: 'student' | 'professor' | 'admin' | 'encadreur' | 'doc';
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string;
  verified?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserResponse extends Omit<User, 'password_hash'> {}

export interface JWTPayload {
  id?: string;
  userId?: string;
  studentId?: string;
  school_id?: string;
  email: string;
  role: 'student' | 'professor' | 'admin' | 'encadreur' | 'doc';
}

// School types
export interface School {
  id: string;
  name: string;
  city?: string;
  country?: string;
  email_domain?: string;
  logo_url?: string;
  description?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Student types
export interface Student {
  id: string;
  school_id?: string;
  encadreur_id?: string;
  user_id?: string;
  professor_id?: string;
  email: string;
  first_name: string;
  last_name: string;
  student_number?: string;
  specialization?: string;
  status?: 'active' | 'on_track' | 'at_risk' | 'completed';
  password_hash?: string;
  inactivity_days?: number;
  enrolled_at: Date;
}

// Professor types
export interface Professor {
  id: string;
  user_id: string;
  department?: string;
  expertise?: string;
  max_students: number;
}

// Project types
export interface Project {
  id: string;
  student_id: string;
  title: string;
  description: string;
  status: 'planning' | 'in_progress' | 'review' | 'completed';
  progress_percentage: number;
  start_date: Date;
  expected_end_date: Date;
  created_at: Date;
  updated_at: Date;
}

// Journal entry types
export interface JournalEntry {
  id: string;
  project_id: string;
  content: string;
  entry_date: Date;
  sentiment: 'positive' | 'neutral' | 'concerning';
  submitted: boolean;
  created_at: Date;
  updated_at: Date;
}

// Alert types
export interface Alert {
  id: string;
  professor_id: string;
  student_id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  is_read: boolean;
  created_at: Date;
  updated_at: Date;
}

// Notification types
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'alert' | 'journal' | 'project' | 'system';
  is_read: boolean;
  created_at: Date;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Request context with user info
export interface RequestContext {
  user?: JWTPayload;
}

// Express Request extension
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
