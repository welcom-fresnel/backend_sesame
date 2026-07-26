# 📖 Guide Détaillé d'Intégration API — SESSAME Admin

Ce document explique en détail l'architecture, la convention d'API et la démarche à suivre pour connecter le backend Node.js (Express, NestJS, Fastify, etc.) à l'application frontend `thesis-tracker-admin`.

---

## 📍 1. Principes Généraux de l'API

L'application frontend utilise **TanStack Query (React Query)** et un **Client HTTP centralisé** qui s'attendent à des règles strictes pour toutes les communications HTTP.

### 🔑 Base URL & Variable d'Environnement
Toutes les requêtes sont émises vers la base URL configurée dans le fichier `.env` du frontend :
```env
VITE_API_URL=http://localhost:3000
```
*Si la variable n'est pas définie, le frontend utilise `http://localhost:3000` par défaut.*

---

## 🔒 2. Authentification & Sécurité

1. **Protocol** : JSON Web Token (JWT) transmis dans le header HTTP `Authorization`.
2. **Format du Header** :
   ```http
   Authorization: Bearer <token_jwt>
   ```
3. **Persistance** : Le token est stocké dans le `localStorage` sous la clé `access_token`.
4. **Gestion du 401 Unauthorized** :
   Si le backend renvoie un code HTTP `401`, le frontend **supprime automatiquement le token** et redirige l'utilisateur vers l'écran de connexion (`/`).

---

## 📦 3. Structure Standardisée des Réponses JSON

Le backend **DOIT** envelopper **TOUTES** ses réponses JSON dans une structure uniforme `ApiResponse<T>` :

### ✅ En cas de Succès (`200 OK`, `201 Created`)
```json
{
  "success": true,
  "data": { ... }
}
```

### ❌ En cas d'Erreur (`400`, `401`, `403`, `404`, `500`)
```json
{
  "success": false,
  "error": "Description lisible du problème ou message d'erreur"
}
```

---

## 🚦 4. Codes d'Erreur HTTP Requis

Le frontend intercepte les codes HTTP suivants et affiche des retours adaptés :

| Code HTTP | Cas d'usage Backend | Comportement Frontend |
| :--- | :--- | :--- |
| `200 OK` | Succès lecture/mise à jour | Affiche les données |
| `201 Created` | Ressource créée (ex: promotion) | Invalide le cache et ferme la modale |
| `401 Unauthorized` | Token absent, invalide ou expiré | Déconnexion + Redirection login |
| `403 Forbidden` | Rôle insuffisant (ex: non-admin) | Message : *"Accès non autorisé"* |
| `404 Not Found` | Ressource introuvable | Message : *"Ressource introuvable"* |
| `500 Server Error` | Panique/Erreur interne backend | Message avec le contenu du champ `error` |

---

## 📄 5. Convention de Pagination & Filtrage

Pour les listes volumineuses (ex: étudiants), le backend doit supporter la pagination et le filtrage via la Query String URL.

**Format de la requête :**
`GET /api/admin/students?page=1&limit=30&q=martin&cohort=Licence%203&status=on-track`

**Format de la réponse attendue (`PaginatedStudents`) :**
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "id": "s1",
        "name": "Lucas Martin",
        "email": "lucas.martin@u-psud.fr",
        "cohort": "Licence 3 Informatique",
        "professor": "Dr. Marie Lefèvre",
        "progress": 72,
        "status": "on-track",
        "lastActive": "Il y a 1h",
        "thesisTitle": "Algorithmes de tri parallèles"
      }
    ],
    "total": 1248,
    "page": 1,
    "limit": 30,
    "totalPages": 42
  }
}
```

---

## 📑 6. Liste Complète des Endpoints REST à Implémenter

Voici la spécification exacte des 7 groupes d'endpoints que le backend doit exposer :

---

### 1️⃣ Auth (`/api/auth`)

#### `POST /api/auth/login`
- **Body** : `{ "email": "admin@u-psud.fr", "password": "..." }`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": {
      "user": { "id": "u1", "email": "admin@u-psud.fr", "role": "admin" },
      "tokens": { "accessToken": "eyJhbGciOi..." }
    }
  }
  ```

---

### 2️⃣ Dashboard (`/api/admin/stats`)

#### `GET /api/admin/stats`
- **Headers** : `Authorization: Bearer <token>`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": {
      "institution": {
        "name": "Université Paris-Saclay",
        "code": "UPS-2026",
        "totalStudents": 1248,
        "totalProfessors": 87,
        "activeProjects": 1142,
        "avgCompletion": 64
      },
      "progressDistribution": [
        { "name": "Recherche", "value": 18 },
        { "name": "Rédaction", "value": 32 },
        { "name": "Révision", "value": 24 },
        { "name": "Soutenance", "value": 14 },
        { "name": "Terminé", "value": 12 }
      ],
      "activityHeatmap": [
        { "day": "Lun", "value": 78 },
        { "day": "Mar", "value": 92 },
        { "day": "Mer", "value": 86 },
        { "day": "Jeu", "value": 95 },
        { "day": "Ven", "value": 71 },
        { "day": "Sam", "value": 42 },
        { "day": "Dim", "value": 28 }
      ],
      "recentAlerts": [
        { "id": "a1", "type": "danger", "message": "12 étudiants inactifs depuis 14+ jours", "time": "Il y a 1h" },
        { "id": "a2", "type": "warning", "message": "Cohorte L3 Droit sous la moyenne (49%)", "time": "Il y a 3h" }
      ]
    }
  }
  ```

---

### 3️⃣ Étudiants (`/api/admin/students`)

#### `GET /api/admin/students`
- **Query Params (Optionnels)** : `page`, `limit`, `q`, `cohort`, `professor`, `status` (`on-track` | `at-risk` | `blocked` | `completed`)
- **Response `200 OK`** : Voir section 5 (Pagination).

---

### 4️⃣ Professeurs (`/api/admin/professors`)

#### `GET /api/admin/professors`
- **Query Params (Optionnel)** : `q` (recherche nom ou département)
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "p1",
        "name": "Dr. Marie Lefèvre",
        "email": "m.lefevre@u-psud.fr",
        "department": "Informatique",
        "studentsSupervised": 14,
        "lastLogin": "Il y a 2 heures",
        "status": "active"
      }
    ]
  }
  ```

#### `DELETE /api/admin/professors/:id`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": { "message": "Professeur supprimé avec succès." }
  }
  ```

---

### 5️⃣ Promotions / Cohortes (`/api/admin/cohorts`)

#### `GET /api/admin/cohorts`
- **Query Params (Optionnel)** : `q`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "c1",
        "name": "Licence 3 Informatique",
        "year": "2025-2026",
        "students": 142,
        "avgProgress": 72,
        "professors": 8,
        "accessCode": "L3-INFO-2026",
        "department": "Sciences"
      }
    ]
  }
  ```

#### `GET /api/admin/cohorts/:id/students`
- **Response `200 OK`** : Liste des étudiants rattachés à la cohorte.

#### `POST /api/admin/cohorts`
- **Body** : `{ "name": "Master 1 IA", "year": "2025-2026", "department": "Informatique" }`
- **Response `201 Created`** : Objet de la cohorte créée (le backend génère l'`accessCode`).

---

### 6️⃣ Analytique (`/api/admin/analytics`)

#### `GET /api/admin/analytics`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": {
      "summary": {
        "engagementYoY": "+24%",
        "onTimeCompletion": "76%",
        "blockedStudents": 112,
        "blockedPercentage": "8.9%"
      },
      "yearOverYear": [
        { "month": "Sept", "2024": 42, "2025": 58 },
        { "month": "Oct", "2024": 51, "2025": 65 }
      ],
      "cohortCompletion": [
        { "cohort": "L3 Info", "onTime": 88, "late": 12 }
      ],
      "blockingReasons": [
        { "reason": "Manque de sources", "count": 142 },
        { "reason": "Difficultés méthodologiques", "count": 118 }
      ]
    }
  }
  ```

---

### 7️⃣ Paramètres (`/api/admin/settings`)

#### `GET /api/admin/settings`
- **Response `200 OK`** :
  ```json
  {
    "success": true,
    "data": {
      "institution": {
        "name": "Université Paris-Saclay",
        "code": "UPS-2026",
        "emailDomain": "@u-psud.fr",
        "logoUrl": null
      },
      "alertThresholds": {
        "inactivityDays": 7,
        "criticalProgress": 30,
        "preDefenseDays": 14
      },
      "academicDates": [
        { "label": "Validation du sujet", "date": "2025-11-15" },
        { "label": "Dépôt final du mémoire", "date": "2026-05-15" }
      ],
      "license": {
        "plan": "Université Pro",
        "seatsUsed": 1335,
        "seatsTotal": 2000,
        "renewalDate": "31 août 2026"
      }
    }
  }
  ```

#### `PUT /api/admin/settings`
- **Body** : L'objet complet `AdminSettings` modifié.
- **Response `200 OK`** : L'objet `AdminSettings` à jour.

---

## 🧪 7. Comment Tester l'Intégration

1. **Lancer le serveur Backend** sur le port `3000` (ou autre port spécifié dans `.env`).
2. **Tester les endpoints avec cURL / Postman** :
   ```bash
   curl -X GET http://localhost:3000/api/admin/stats \
     -H "Authorization: Bearer VOTRE_TOKEN_JWT"
   ```
3. **Vérifier les Headers CORS** :
   Assurez-vous que le serveur backend inclut les headers CORS appropriés pour autoriser l'origine Vite (ex: `http://localhost:8080` ou `http://localhost:5173`) :
   ```http
   Access-Control-Allow-Origin: * (ou http://localhost:8080)
   Access-Control-Allow-Headers: Content-Type, Authorization
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
   ```
