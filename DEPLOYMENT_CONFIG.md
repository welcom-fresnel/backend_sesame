# SESSAME CFI — Config de Déploiement (Backend + 3 Frontends)

Ce fichier liste **quoi configurer** après avoir hébergé le backend, et **quoi mettre** dans chaque frontend.

## 1) Backend (Express) — Variables d’environnement (Production)

À définir dans ton hébergeur (Render/Railway/Fly/VM, etc.) pour le service `backend/` :

- `NODE_ENV=production`
- `PORT=3000` (ou imposé par l’hébergeur)
- `DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME`
- `JWT_SECRET=<une longue chaîne aléatoire>`
- `CORS_ORIGIN=<liste d’origins autorisées, séparées par des virgules>`
  - Exemple :
    - `CORS_ORIGIN=https://admin.sessame.tld,https://encadreur.sessame.tld,https://etudiant.sessame.tld,http://localhost:5173,http://localhost:5174,http://localhost:5175`
- `FRONTEND_URL=https://encadreur.sessame.tld` (frontend encadreur, optionnel)
- `STUDENT_FRONTEND_URL=https://etudiant.sessame.tld` (frontend étudiant — **liens d'invitation** `/join/:token`)

Recommandé (si tu mets le backend derrière un proxy/https) :
- Activer TLS/HTTPS sur le domaine API (ex: `https://api.sessame.tld`)

### Checklist backend
- Base PostgreSQL “managed” + backups
- Le backend est accessible via `https://api.sessame.tld/health`
- CORS autorise bien les 3 frontends
- Les migrations sont exécutées une fois :
  - `npm run db:migrate`
  - `npm run db:migrate:multitenant`
  - (optionnel) `npm run db:seed` et `npm run db:seed:schools` en staging/dev

## 2) Frontends (Vite/TanStack) — Variables VITE_*

Chaque frontend doit pointer vers l’URL publique du backend.

Dans **chaque** app :
- `encadreur-connect/.env.local`
- `project-companion/.env.local`
- `thesis-tracker-admin/.env.local`

Mettre :
```env
VITE_API_URL=https://api.sessame.tld
```

### Checklist frontends
- Le frontend est servi en HTTPS (ex: Cloudflare Pages/Netlify/Vercel)
- L’app arrive à appeler :
  - `GET https://api.sessame.tld/health`
  - `POST https://api.sessame.tld/api/auth/login`
- Pas d’erreur navigateur “CORS blocked”

## 3) Noms de domaines (recommandé)

- Backend API : `api.sessame.tld`
- Admin : `admin.sessame.tld` (app: `thesis-tracker-admin`)
- Encadreur : `encadreur.sessame.tld` (app: `encadreur-connect`)
- Étudiant : `etudiant.sessame.tld` (app: `project-companion`)

## 4) Auth / Tokens (comportement attendu)

- Le backend renvoie un `accessToken` JWT.
- Les frontends stockent `access_token` dans `localStorage`.
- Les appels API incluent `Authorization: Bearer <token>`.

## 5) Connexions WebSocket (si activées côté frontend)

Si tu utilises Socket.io en prod :
- Assure-toi que le domaine `api.sessame.tld` accepte WebSocket (souvent OK sur Render/Fly/VM).
- Les reverse proxies doivent supporter `Upgrade: websocket`.

## 6) Exemple “dev local” (rappel)

Backend :
```powershell
cd backend
npm run db:migrate
npm run db:migrate:multitenant
npm run dev
```

Admin (idem pour les 2 autres frontends) :
```powershell
cd thesis-tracker-admin
# .env.local => VITE_API_URL=http://localhost:3000
npm run dev
```

## 7) Comptes de test (si seed exécuté)

Après `cd backend && npm run db:seed` :
- Admin : `admin@university.fr` / `admin123`
- Prof : `prof.martin@university.fr` / `professor123`

