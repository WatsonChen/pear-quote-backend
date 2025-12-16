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

## Data Models & API Reference

- **Data Models**: Please refer to `prisma/schema.prisma` for the source of truth regarding database models.
- **API Reference**: Please refer to the Swagger documentation at `/api-docs` (when running locally) or the `openapi.yaml` file.
