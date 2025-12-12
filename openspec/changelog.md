# Changelog

## 2025-12-12 - Login API Implementation

**Branch:** `feature-20251212-login-api`

### 新增功能

- ✅ User authentication with JWT
- ✅ Login API (`POST /api/login`)
- ✅ Get current user API (`GET /api/me`)

### 新增/修改檔案

**Schema:**

- `prisma/schema.prisma`: 新增 User model

**Dependencies:**

- Added `bcrypt` for password hashing
- Added `jsonwebtoken` for JWT token management

**Utilities & Middleware:**

- `src/lib/jwt.js`: JWT token sign/verify utilities
- `src/middleware/authMiddleware.js`: Authentication middleware

**Business Logic:**

- `src/services/authService.js`: Auth service (login, getUserById, createUser)

**Controllers:**

- `src/controllers/authController.js`: Auth request handlers (handleLogin, handleGetMe)

**Routes:**

- `src/routes/authRoutes.js`: Auth route definitions
- `src/app.js`: 註冊 auth routes

**Scripts:**

- `scripts/createTestUser.js`: Test user creation script

**Documentation:**

- `openspec/spec.md`: API documentation for auth endpoints
- `openspec/tasks.md`: Updated task list
- `docs/backend-guide.md`: Updated with auth architecture

---

## Unreleased

- Initial project structure setup.
