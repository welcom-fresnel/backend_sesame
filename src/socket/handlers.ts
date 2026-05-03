import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
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
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`✅ Client connected: ${socket.id} (User: ${socket.userId}, Role: ${socket.userRole})`);

    // Rejoindre les rooms appropriées selon le rôle
    if (socket.userId && socket.userRole) {
      // Room personnelle pour les notifications individuelles
      socket.join(`user_${socket.userId}`);

      // Room selon le rôle
      socket.join(`role_${socket.userRole}`);

      // Si c'est un étudiant, rejoindre sa room étudiante
      if (socket.userRole === 'student') {
        socket.join(`student_${socket.userId}`);
      }

      // Si c'est un professeur, rejoindre sa room professeur
      if (socket.userRole === 'professor') {
        socket.join(`professor_${socket.userId}`);
      }

      console.log(`📍 User ${socket.userId} joined rooms: user_${socket.userId}, role_${socket.userRole}`);
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

  // Notifier tous les admins
  notifyAdmins(event: string, data: any) {
    this.notifyRole('admin', event, data);
  }

  // Diffusion globale
  broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }
}