# SESSAME Backend API

Backend API pour la plateforme SESSAME CFI - gestion intégrée des projets de fin d'études.

## 🚀 Getting Started

### Requirements
- Node.js 18+
- PostgreSQL 13+
- npm ou bun

### Installation

```bash
cd backend
yarn install
# ou
npm install
# ou
bun install
```

### Setup Environment

```bash
cp .env.example .env
```

Configurer les variables :
```env
DATABASE_URL=postgresql://user:password@localhost:5432/sessame_db
JWT_SECRET=your-super-secret-key-change-in-production
NODE_ENV=development
PORT=3000
```

### Database Setup

```bash
# Créer la base de données
createdb sessame_db

# Exécuter les migrations
yarn db:migrate
```

### Development

```bash
yarn dev
```

Le serveur démarre sur `http://localhost:3000`

### Build

```bash
yarn build
yarn start
```

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - Inscription
- `POST /api/auth/login` - Connexion
- `GET /api/auth/me` - Profil utilisateur

### Students
- `GET /api/students` - Liste des étudiants (admin)
- `GET /api/students/:studentId` - Détails étudiant
- `GET /api/students/professor/students` - Étudiants du professeur
- `PUT /api/students/:studentId` - Modifier étudiant
- `GET /api/students/:studentId/projects` - Projets étudiant

### Projects
- `POST /api/projects` - Créer projet
- `GET /api/projects` - Liste projets (admin)
- `GET /api/projects/:projectId` - Détails projet
- `PUT /api/projects/:projectId` - Modifier projet
- `POST /api/projects/:projectId/journal` - Ajouter entrée journal
- `GET /api/projects/:projectId/journal` - Journal du projet

### Alerts
- `POST /api/alerts` - Créer alerte
- `GET /api/alerts` - Liste alertes (admin)
- `GET /api/alerts/user/me` - Mes alertes
- `PATCH /api/alerts/:alertId/read` - Marquer comme lue
- `DELETE /api/alerts/:alertId` - Supprimer alerte

## 🔐 Authentication

Tous les endpoints (sauf `/api/auth/register` et `/api/auth/login`) requièrent un JWT token dans le header :

```
Authorization: Bearer <token>
```

## 🏗️ Project Structure

```
src/
  ├── index.ts           # Entry point
  ├── types/             # TypeScript types
  ├── config/            # Configuration
  ├── db/                # Database setup & migrations
  ├── middleware/        # Express middleware
  ├── routes/            # API routes
  └── utils/             # Utilities (JWT, Password hash)
```

## 🔗 WebSocket Events

### Client → Server
- `authenticate` - Authentifier le socket
- `join_room` - Rejoindre une room

### Server → Client
- `alert:new` - Nouvelle alerte
- `project:update` - Mise à jour projet
- `journal:submitted` - Journal soumis
- `notification:new` - Nouvelle notification

## 🚀 Deployment sur Render

1. Push sur GitHub
2. Connecter le repository à Render
3. Configuration :
   - **Build Command**: `yarn install && yarn build`
   - **Start Command**: `yarn start`
   - **Environment Variables**: Ajouter `DATABASE_URL`, `JWT_SECRET`

## 📝 Notes

- Les migrations créent automatiquement toutes les tables et indexes
- Les passwords sont hashés avec bcrypt (10 rounds)
- Les JWTs expirent après 24h (configurable)
- CORS est activé pour les 3 frontends

## 🐛 Troubleshooting

### Database connection failed
- Vérifier que PostgreSQL est en cours d'exécution
- Vérifier la DATABASE_URL

### Token invalid
- Vérifier que JWT_SECRET est identique entre les requêtes
- Vérifier que le token n'a pas expiré

## 📞 Support

Pour toute question, ouvrir une issue sur le repository.

## 🛠️ Modifications récentes (résumé des travaux)

Ces notes listent les changements appliqués pendant la session de développement actuelle :

- Correction de la variable `DATABASE_URL` dans `backend/.env` (suppression d'un point-virgule final) pour rétablir la connexion DB.
- Ajout de mécanismes de retry / diagnostics dans l'initialisation de la connexion PG.
- Migration multi-tenant : création de la table `schools`, introduction de `school_id` sur `users`, `professors`, `students`, et contrainte unique `(school_id, email)` pour les `users`.
- Création de la table `student_join_links` pour gérer les invitations et tokens d'inscription.
- Rendre les seeds idempotents (`ON CONFLICT`) pour éviter les échecs lors des ré-exécutions.
- Normalisation du payload JWT et du middleware `auth` pour supporter `id`, `userId`, `studentId` de façon cohérente.
- Correction du flux d'invitation/join :
  - `POST /api/auth/encadreur/add` insère correctement les `student_join_links` avec `school_id` et `encadreur_id` normalisés.
  - `POST /api/students/join/:token` : correction du handler pour créer d'abord une ligne dans `users` (email + password_hash + role='student'), puis créer la ligne `students` référencée par `user_id`, et marquer le lien comme utilisé.
- Mise à jour des routes `students` pour exposer `GET /api/students` et `GET /api/students/:studentId` incluant les champs utilisateurs (email, first_name, last_name) et autorisations multi-tenant (admin, professeur assigné, encadreur/doc de la même école).
- Fix divers problèmes de permissions (403/401) et erreurs SQL (colonne inexistante) liés à l'évolution du schéma.

Si vous voulez une entrée CHANGELOG plus détaillée (commits, fichiers modifiés, diff), je peux générer un fichier `CHANGELOG.md` séparé avec la liste complète.
