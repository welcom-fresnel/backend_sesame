import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  studentId?: string;
  school_id?: string;
  userRole?: string;
}

export function setupSocketHandlers(io: SocketIOServer) {
  // Middleware d'authentification pour les sockets
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    try {
      const decoded = jwt.verify(token as string, config.jwt.secret) as any;
      socket.userId = decoded.userId;
      socket.studentId = decoded.studentId;
      socket.school_id = decoded.school_id;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`✅ Client connected: ${socket.id} (User: ${socket.userId}, School: ${socket.school_id}, Role: ${socket.userRole})`);

    // Rejoindre les rooms appropriées selon le rôle
    if (socket.userId && socket.userRole) {
      // Room personnelle pour les notifications individuelles
      socket.join(`user_${socket.userId}`);

      // Room selon l'école pour l'isolation multi-tenant
      if (socket.school_id) {
        socket.join(`school_${socket.school_id}`);
        socket.join(`school_${socket.school_id}_${socket.userRole}`);
      }

      // Room selon le rôle
      socket.join(`role_${socket.userRole}`);

      // Si c'est un étudiant, rejoindre sa room étudiante
      if (socket.userRole === 'student' && socket.studentId) {
        socket.join(`student_${socket.studentId}`);
        if (socket.school_id) {
          socket.join(`school_${socket.school_id}_students`);
        }
      }

      // Si c'est un professeur/encadreur, rejoindre sa room
      if ((socket.userRole === 'professor' || socket.userRole === 'encadreur' || socket.userRole === 'doc') && socket.userId) {
        socket.join(`encadreur_${socket.userId}`);
        if (socket.school_id) {
          socket.join(`school_${socket.school_id}_encadreurs`);
        }
      }

      console.log(`📍 User ${socket.userId} (${socket.userRole}) joined rooms:`, [
        `user_${socket.userId}`,
        socket.school_id ? `school_${socket.school_id}` : null,
        socket.school_id ? `school_${socket.school_id}_${socket.userRole}` : null,
        `role_${socket.userRole}`,
      ].filter(Boolean));
    }

    // Écouter les événements personnalisés
    socket.on('join_project_room', (projectId: string) => {
      socket.join(`project_${projectId}`);
      console.log(`📍 User ${socket.userId} joined project room: project_${projectId}`);
    });

    socket.on('leave_project_room', (projectId: string) => {
      socket.leave(`project_${projectId}`);
      console.log(`📍 User ${socket.userId} left project room: project_${projectId}`);
    });

    socket.on('disconnect', () => {
      console.log(`❌ Client disconnected: ${socket.id} (User: ${socket.userId})`);
    });

    // Gestion des erreurs
    socket.on('error', (error: Error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });
}

// Fonctions utilitaires pour émettre des événements
export class SocketEmitter {
  constructor(private io: SocketIOServer) {}

  // Notifier un utilisateur spécifique
  notifyUser(userId: string, event: string, data: any) {
    this.io.to(`user_${userId}`).emit(event, data);
  }

  // Notifier tous les utilisateurs d'une école
  notifySchool(schoolId: string, event: string, data: any) {
    this.io.to(`school_${schoolId}`).emit(event, data);
  }

  // Notifier tous les encadreurs d'une école
  notifySchoolEncadreurs(schoolId: string, event: string, data: any) {
    this.io.to(`school_${schoolId}_encadreurs`).emit(event, data);
  }

  // Notifier tous les étudiants d'une école
  notifySchoolStudents(schoolId: string, event: string, data: any) {
    this.io.to(`school_${schoolId}_students`).emit(event, data);
  }

  // Notifier tous les utilisateurs d'un rôle dans une école
  notifySchoolRole(schoolId: string, role: string, event: string, data: any) {
    this.io.to(`school_${schoolId}_${role}`).emit(event, data);
  }

  // Notifier un étudiant spécifique
  notifyStudent(studentId: string, event: string, data: any) {
    this.io.to(`student_${studentId}`).emit(event, data);
  }

  // Notifier un encadreur spécifique
  notifyEncadreur(encadreurId: string, event: string, data: any) {
    this.io.to(`encadreur_${encadreurId}`).emit(event, data);
  }

  // Notifier tous les utilisateurs d'un rôle
  notifyRole(role: string, event: string, data: any) {
    this.io.to(`role_${role}`).emit(event, data);
  }

  // Notifier tous les participants d'un projet
  notifyProject(projectId: string, event: string, data: any) {
    this.io.to(`project_${projectId}`).emit(event, data);
  }

  // Notifier tous les professeurs
  notifyProfessors(event: string, data: any) {
    this.notifyRole('professor', event, data);
  }

  // Notifier tous les étudiants
  notifyStudents(event: string, data: any) {
    this.notifyRole('student', event, data);
  }

  // Notifier tous les encadreurs
  notifyEncadreurs(event: string, data: any) {
    this.notifyRole('encadreur', event, data);
  }

  // Notifier tous les admins
  notifyAdmins(event: string, data: any) {
    this.notifyRole('admin', event, data);
  }

  // Diffusion globale
  broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }
}