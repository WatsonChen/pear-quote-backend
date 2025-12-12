# API Specification

## Overview

This document describes the API endpoints, parameters, and behaviors for the pear-backend service.

---

## Data Models

### User

Represents a user account in the system.

| Field          | Type          | Description                |
| -------------- | ------------- | -------------------------- |
| `id`           | String (UUID) | Unique user identifier     |
| `email`        | String        | User email (unique)        |
| `passwordHash` | String        | Bcrypt hashed password     |
| `createdAt`    | DateTime      | Account creation timestamp |
| `updatedAt`    | DateTime      | Last update timestamp      |

---

## Authentication Endpoints

### POST /api/login

User login with email and password.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Success Response (200):**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com"
  }
}
```

**Error Responses:**

**400 Bad Request** - Missing required fields:

```json
{
  "success": false,
  "message": "Email and password are required"
}
```

**401 Unauthorized** - Invalid credentials:

```json
{
  "success": false,
  "message": "Invalid email or password"
}
```

**500 Internal Server Error:**

```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

### GET /api/me

Get current authenticated user information.

**Headers:**

```
Authorization: Bearer <token>
```

**Success Response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "createdAt": "2025-12-12T08:00:00.000Z"
}
```

**Error Responses:**

**401 Unauthorized** - No token provided:

```json
{
  "success": false,
  "message": "No token provided"
}
```

**401 Unauthorized** - Invalid token format:

```json
{
  "success": false,
  "message": "Invalid token format. Expected 'Bearer <token>'"
}
```

**401 Unauthorized** - Invalid or expired token:

```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

**404 Not Found** - User not found:

```json
{
  "success": false,
  "message": "User not found"
}
```

**500 Internal Server Error:**

```json
{
  "success": false,
  "message": "Internal server error"
}
```

---

## Quote Endpoints

(Existing quote endpoints documentation can be added here)
