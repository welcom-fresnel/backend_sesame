# Guide de déploiement Render — SESSAME CFI

Ce document décrit exactement ce qu’il faut faire pour déployer :
- la base de données PostgreSQL,
- le backend,
- les frontends,
- les variables d’environnement.

---

## 1) Pré-requis

Avant de commencer, il faut :
- un compte Render : https://render.com
- un dépôt GitHub avec tout le projet
- les trois frontends et le backend dans le même repository (ou bien dans des repos séparés si vous préférez)

Le projet contient :
- backend
- encadreur-connect
- project-companion
- thesis-tracker-admin

---

## 2) Créer la base de données PostgreSQL sur Render

### Étape 2.1 — Créer le service de base
1. Connectez-vous à Render.
2. Dans le tableau de bord, cliquez sur New +.
3. Choisissez PostgreSQL.
4. Remplissez les informations :
   - Name : sesame-db
   - Database : sesame_db
   - User : postgres (ou garder la valeur par défaut)
   - Region : choisissez la région la plus proche de votre audience
   - Plan : Free ou Starter selon votre besoin
5. Cliquez sur Create Database.

### Étape 2.2 — Récupérer la connexion
Une fois créé, Render affiche :
- External Database URL
- Internal Database URL

Vous devez garder la valeur de la variable qui ressemble à ceci :

```env
postgresql://<user>:<password>@<host>:<port>/<database>
```

### Étape 2.3 — Vérifier que la base est prête
Render créera automatiquement la base. Vous n’avez pas besoin de créer les tables manuellement au départ si le backend les crée via les migrations.

---

## 3) Déployer le backend sur Render

### Étape 3.1 — Créer le service Web Service
1. Dans Render, cliquez sur New +.
2. Choisissez Web Service.
3. Connectez votre dépôt GitHub.
4. Sélectionnez le dossier du backend :
   - Root Directory : backend

### Étape 3.2 — Configuration du build
Dans la page de création du service, remplissez :
- Name : sesame-backend
- Runtime : Node
- Build Command :

```bash
npm install && npm run build
```

- Start Command :

```bash
npm run start
```

### Étape 3.3 — Variables d’environnement backend
Ajoutez exactement ces variables :

```env
NODE_ENV=production
PORT=10000
JWT_SECRET=change-this-to-a-long-random-string
JWT_EXPIRES_IN=24h
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
FRONTEND_URL=https://<votre-front-encadreur>.onrender.com
CORS_ORIGIN=https://<admin>.onrender.com,https://<companion>.onrender.com,https://<encadreur>.onrender.com
SOCKET_IO_CORS=https://<admin>.onrender.com,https://<companion>.onrender.com,https://<encadreur>.onrender.com
```

### Étape 3.4 — Déployer
Cliquez sur Create Web Service.

Render va automatiquement construire et démarrer le backend.

### Étape 3.5 — Vérifier le backend
Une fois le service lancé, ouvrez l’URL Render fournie par Render.
Testez cette URL :

```text
https://<votre-backend>.onrender.com/health
```

Résultat attendu :

```json
{ "status": "ok" }
```

---

## 4) Initialiser les tables et les données

Une fois le backend déployé, il faut exécuter les migrations et les seeds.

### Méthode 1 — via la console Render
1. Ouvrez le service backend sur Render.
2. Allez dans la section Shell ou Console.
3. Exécutez :

```bash
npm run db:migrate
npm run db:seed
```

### Important
Le seed crée des comptes de test. Cela est utile pour tester rapidement.

---

## 5) Déployer le frontend admin

### Étape 5.1 — Créer le service de site statique
1. Dans Render, cliquez sur New +.
2. Choisissez Static Site.
3. Connectez votre dépôt GitHub.
4. Sélectionnez le dossier :
   - Root Directory : thesis-tracker-admin

### Étape 5.2 — Configuration du build
- Build Command :

```bash
npm install && npm run build
```

- Publish Directory :

```bash
dist
```

### Étape 5.3 — Variables d’environnement
Ajoutez :

```env
VITE_API_URL=https://<votre-backend>.onrender.com
```

### Étape 5.4 — Déployer
Cliquez sur Create Static Site.

---

## 6) Déployer le frontend companion

Même procédure que l’admin, mais avec le dossier :
- Root Directory : project-companion

### Variables d’environnement
```env
VITE_API_URL=https://<votre-backend>.onrender.com
```

---

## 7) Déployer le frontend encadreur-connect

### Option A — Statique simple
Si l’application est compatible SPA, faites comme les autres frontends :
- Root Directory : encadreur-connect
- Build Command :

```bash
npm install && npm run build
```
- Publish Directory :

```bash
dist
```

### Variables d’environnement
```env
VITE_API_URL=https://<votre-backend>.onrender.com
```

### Important pour les routes internes
Ajoutez un fichier de rewrite pour les routes comme /register-professor.

Dans le dossier du frontend, créez un fichier :
- public/_redirects

Contenu :

```text
/* /index.html 200
```

Si vous utilisez Render Static Site, cela permet d’éviter les 404 sur des URLs internes.

---

## 8) Ajuster les variables d’environnement après déploiement

Une fois que chaque service a une URL Render, il faut les utiliser dans les variables d’environnement du backend.

### Backend final à utiliser
```env
FRONTEND_URL=https://<encadreur-connect>.onrender.com
CORS_ORIGIN=https://<admin>.onrender.com,https://<companion>.onrender.com,https://<encadreur-connect>.onrender.com
SOCKET_IO_CORS=https://<admin>.onrender.com,https://<companion>.onrender.com,https://<encadreur-connect>.onrender.com
```

### Frontends
```env
VITE_API_URL=https://<backend>.onrender.com
```

---

## 9) Vérifications finales

### Vérifier le backend
- URL : https://<backend>.onrender.com/health
- doit répondre avec un JSON valide

### Vérifier l’authentification
- ouvrir le frontend admin
- se connecter avec un compte de test

### Vérifier l’invitation professeur
- créer un professeur depuis l’admin
- ouvrir le lien généré
- vérifier que la page d’inscription s’affiche

---

## 10) Comptes de test après seed

Après l’exécution du seed, vous pouvez utiliser :

### Admin
- Email : admin@university.fr
- Password : admin123

### Professeur
- Email : prof.martin@university.fr
- Password : professor123

### Étudiant
- Email : student1@university.fr
- Password : student123

---

## 11) Résumé ultra simple

Si vous voulez la version la plus courte :

1. Créer la base PostgreSQL sur Render.
2. Récupérer DATABASE_URL.
3. Déployer le backend avec cette variable + JWT_SECRET.
4. Exécuter les migrations et le seed.
5. Déployer chaque frontend avec VITE_API_URL pointant vers le backend.
6. Définir les URLs publiques dans CORS/FRONTEND_URL.

---

## 12) Erreurs fréquentes à éviter

- Utiliser localhost pour la base de données en production.
- Oublier de mettre VITE_API_URL sur les frontends.
- Oublier CORS_ORIGIN pour les domaines publics.
- Oublier public/_redirects pour les routes internes.
- Oublier d’exécuter npm run db:migrate et npm run db:seed.

---

Si vous voulez, je peux maintenant vous générer la version encore plus pratique sous forme de “checklist Render” que vous pouvez suivre case par case sans rien oublier.
