# Migration: Remplacer S3 par solution locale / Supabase Storage

Objectif
- Supprimer la dépendance S3 côté backend.
- Implémenter un système de stockage togglable: `local` pour dev + `supabase` pour production.
- Imposer une taille maximale par fichier: 50 Mo (50 * 1024 * 1024 bytes).

Approche globale
1. Configuration
   - Ajouter dans `config` (backend/src/config/index.ts):
     - `upload.backend` : `local` | `supabase` (default: `local`)
     - `upload.bucket` : nom du bucket Supabase (par défaut `uploads`)
     - Variables d'environnement requises en production pour Supabase:
       - `SUPABASE_URL`
       - `SUPABASE_SERVICE_KEY` (clé serveur, jamais exposer côté client)
       - `SUPABASE_BUCKET`

2. Dépendances
   - `multer` pour gérer `multipart/form-data` et stocker en local.
   - `@supabase/supabase-js` pour upload serveur -> Supabase Storage.

   Commandes à exécuter:
   ```bash
   cd backend
   npm install multer @supabase/supabase-js
   ```

3. Comportement backend
   - Si `upload.backend === 'local'`:
     - Utiliser `multer` avec `dest = uploads/` et limiter `fileSize` à 50MB.
     - Servir le répertoire `uploads/` via `express.static('/uploads', ...)` (en dev seulement).
     - Générer `file_url` stocké en base comme `${config.frontendUrl}/uploads/${filename}` ou `${config.publicUrl}/uploads/...`.
     - Avantage: simple et rapide en dev. Inconvénient: stockage éphémère sur plateformes comme Render (perdu au redeploy).

   - Si `upload.backend === 'supabase'`:
     - Initialiser client Supabase server-side:
       ```ts
       import { createClient } from '@supabase/supabase-js';
       const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
       ```
     - Récupérer le buffer (via `multer` en mode `memoryStorage`) puis `supabase.storage.from(bucket).upload(key, buffer, { contentType })`.
     - Rendre l'URL publique via `supabase.storage.from(bucket).getPublicUrl(key)`.
     - Stocker `file_url` en base avec l'URL publique.
     - Avantage: persistant, pas d'AWS, intégré à Supabase.

4. Routes
   - Mettre à jour les endpoints concernés (`/api/projects/:id/steps`, `/api/projects/:id/journal`) pour accepter `multipart/form-data`.
   - Exemple: `router.post('/:projectId/steps', authMiddleware, upload.single('file'), async (req, res) => { ... })`.
   - Si l'appel frontend envoie déjà `file_url` ou base64, conserver la compatibilité (support legacy).

5. Validation et sécurité
   - Limiter `fileSize: 50 * 1024 * 1024` dans multer (et vérifier côté Supabase upload si nécessaire).
   - Valider `contentType` et extension (liste blanche si nécessaire).
   - Scanner/filtrer fichiers exécutables si besoin (policy).

6. Frontend changes
   - Remplacer le flux de signature S3 par envoi direct au backend:
     - Au lieu de demander un signed URL, envoyer le fichier via `FormData` (`form.append('file', file)`) au endpoint `POST /api/projects/:id/steps`.
     - Backend répondra avec `file_url` dans la réponse.
   - Garder une compatibilité progressive: si backend retourne `S3 not configured`, revenir à upload as base64 branch (temporary).

7. Variables d'environnement à configurer
   - Pour `local` (dev): pas d'actions supplémentaires.
   - Pour `supabase` (prod) sur Render:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_KEY` (stocké en secret)
     - `SUPABASE_BUCKET` (ex: `uploads`)
     - `UPLOAD_BACKEND=supabase`

8. Tests manuels recommandés
   - En local (UPLOAD_BACKEND=local): créer étape avec fichier de ~1–40 MB, vérifier que `uploads/` contient le fichier et `file_url` est accessible via `http://localhost:PORT/uploads/<file>`.
   - En prod (UPLOAD_BACKEND=supabase): déployer, vérifier upload et URL publique.

9. Rollout
   - Implémenter d'abord le mode `local` (faible risque).
   - Ensuite implémenter `supabase` et tester.

10. Notes d'implémentation
   - Pour le mode Supabase, utiliser `multer` en `memoryStorage` pour obtenir `buffer` directement.
   - Gérer erreurs réseau et cleanup (supprimer fichier local si upload Supabase réussi).

---

Si tu veux, je peux maintenant :
- Implémenter les changements côté backend (tous les fichiers nécessaires) et mettre à jour les routes (Option A demandée),
- Ou commencer par la version locale seulement (plus rapide) si tu veux tester vite.

Dis-moi si je commence l'implémentation complète maintenant. (Je ferai d'abord les modifications `config`, installerai les dépendances, puis modifierai les routes et tests.)
