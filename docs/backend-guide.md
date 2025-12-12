# Backend Development Guide

## 1. File Structure

```
/src
  /routes        # individual route files
  /controllers   # logic per module
  /services      # business logic
  /middleware    # auth, validator, etc.
  /lib           # prisma client, utils, jwt, logger
  app.js
  server.js

/prisma
  schema.prisma
  migrations/

/openspec
  project.md
  spec.md
  tasks.md
  changelog.md

/docs
  backend-guide.md
```

## 2. Git Workflow

- **Branch Naming**: `feature-YYYYMMDD-short-desc` (e.g., `feature-20251212-login-api`)
- **Commit Messages**: Conventional Commits (`feat:`, `fix:`, `docs:`)

## 3. OpenSpec Synchronization

Every task MUST update:

1. `/openspec/spec.md`: API behavior, params, payloads.
2. `/openspec/tasks.md`: Add/Update tasks.
3. `/openspec/changelog.md`: Record changes.

## 4. Development Standards

### 4.1 Prisma

- Schema changes -> `prisma migrate dev` (create migration file).
- Update `backend-guide.md` Data Models section.

### 4.2 API Structure

- Route path
- Controller
- Service
- Prisma Query
- Input Validation
- Standard Error Response: `{ success: false, message: "..." }`

### 4.3 Auth & JWT

- Use `authMiddleware.js`
- `generateToken()` / `verifyToken()` in `src/lib/jwt.js` (or similar)
- Document usage in `backend-guide.md`

## 5. Testing

- Linting required.
- Jest unit tests for Services (if necessary).

## 6. PR Requirements

- **Summary**: What was done.
- **Changes**: API, Schema, OpenSpec updates.
- **Risk & Impact**: Migration needs, Frontend impact.
- **Testing**: How it was verified.

## 7. Pre-Task Analysis

- Detect affected files.
- Propose Draft Plan (Add/Edit/Delete list).
- Wait for approval.

---

## Data Models

### User

用於儲存使用者帳號資訊。

| Field          | Type          | Description            |
| -------------- | ------------- | ---------------------- |
| `id`           | String (UUID) | 唯一識別碼             |
| `email`        | String        | 使用者 email（唯一）   |
| `passwordHash` | String        | Bcrypt 加密的密碼 hash |
| `createdAt`    | DateTime      | 建立時間               |
| `updatedAt`    | DateTime      | 最後更新時間           |

**密碼加密:**

- 使用 bcrypt，強度 10 rounds
- 不儲存明碼密碼

### Quote

現有的 Quote model（待補充完整說明）。

---

## Authentication & JWT

### JWT 架構

**Token 管理:**

- **Location:** `src/lib/jwt.js`
- **Functions:**
  - `signToken(payload)`: 產生 JWT token（有效期 7 天）
  - `verifyToken(token)`: 驗證並解析 token

**JWT Payload:**

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Auth Middleware

**Location:** `src/middleware/authMiddleware.js`

**用途:**

- 從 `Authorization: Bearer <token>` header 讀取 token
- 驗證 token 有效性
- 將 user 資訊注入 `req.user`

**使用範例:**

```javascript
import { authMiddleware } from "../middleware/authMiddleware.js";

router.get("/protected-route", authMiddleware, (req, res) => {
  // req.user.userId 和 req.user.email 可用
  const { userId, email } = req.user;
  // ...
});
```

### 驗證流程

1. **登入:**

   ```
   Client → POST /api/login
          ↓ (email, password)
          ↓ authService.login()
          ↓ - 查詢 User by email
          ↓ - bcrypt.compare(password, passwordHash)
          ↓ - signToken({ userId, email })
          ↓
   Client ← { success: true, token, user }
   ```

2. **受保護的 API 呼叫:**
   ```
   Client → GET /api/me
          → Header: Authorization: Bearer <token>
          ↓ authMiddleware
          ↓ - 讀取 token
          ↓ - verifyToken(token)
          ↓ - req.user = { userId, email }
          ↓ Controller
          ↓ - getUserById(req.user.userId)
          ↓
   Client ← { id, email, createdAt }
   ```

### 錯誤處理

**標準錯誤格式:**

```json
{
  "success": false,
  "message": "Error description"
}
```

**常見錯誤 Status Codes:**

- `400 Bad Request`: 缺少必要欄位
- `401 Unauthorized`: 驗證失敗（密碼錯誤、token 無效、token 過期）
- `404 Not Found`: 資源不存在
- `500 Internal Server Error`: 伺服器錯誤

---

## API Reference

### Authentication

#### POST /api/login

登入並取得 JWT token。

**Request:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": "uuid", "email": "user@example.com" }
}
```

#### GET /api/me

取得當前登入使用者資訊（需要驗證）。

**Headers:**

```
Authorization: Bearer <token>
```

**Response (200):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "createdAt": "2025-12-12T08:00:00.000Z"
}
```

### Quotes

詳見 `openspec/spec.md`。
