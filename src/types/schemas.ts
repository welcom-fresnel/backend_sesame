import { z } from 'zod';

function normalizeEmailDomain(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const value = input.trim().toLowerCase();
  if (!value) return value;
  // Allow users to paste an email (ex: "john@university.fr") and extract the domain.
  if (value.includes('@')) {
    const parts = value.split('@');
    return parts[parts.length - 1] ?? value;
  }
  return value;
}

// Schémas pour les écoles
export const schoolSchema = z.object({
  name: z.string().min(2, 'School name required'),
  city: z.string().optional(),
  country: z.string().optional(),
  // Domain only (ex: "university.fr"), not an email address.
  email_domain: z.preprocess(
    normalizeEmailDomain,
    z
      .string()
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,})+$/,
        'Invalid email domain (ex: university.fr)'
      )
      .optional()
  ),
  logo_url: z.string().url().optional(),
  description: z.string().optional(),
});

export const createSchoolSchema = schoolSchema.extend({
  email_domain: z.preprocess(
    normalizeEmailDomain,
    z
      .string()
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{2,})+$/,
        'Invalid email domain (ex: university.fr)'
      )
  ),
});

export type School = z.infer<typeof schoolSchema>;
export type CreateSchoolRequest = z.infer<typeof createSchoolSchema>;

// Schémas pour l'inscription encadreur
export const encadreurRegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().min(2, 'First name required'),
  last_name: z.string().min(2, 'Last name required'),
  phone: z.string().optional(),
  school_id: z.string().uuid('Invalid school ID'),
  role: z.enum(['encadreur', 'doc']).default('encadreur'),
});

export const encadreurVerifySchema = z.object({
  email: z.string().email(),
  verification_code: z.string().length(6, 'Code must be 6 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type EncadreurRegisterRequest = z.infer<typeof encadreurRegisterSchema>;
export type EncadreurVerifyRequest = z.infer<typeof encadreurVerifySchema>;

// Schémas pour l'ajout d'étudiant
export const addStudentSchema = z.object({
  email: z.string().email('Invalid email'),
  first_name: z.string().min(2),
  last_name: z.string().min(2),
});

export type AddStudentRequest = z.infer<typeof addStudentSchema>;

// Schémas pour l'accès étudiant via lien
export const studentJoinSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type StudentJoinRequest = z.infer<typeof studentJoinSchema>;
