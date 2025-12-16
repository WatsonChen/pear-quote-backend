# API Specification

> **Note**: This document is a high-level overview. For the precise API definition and testing, please verify `openapi.yaml` or visit `/api-docs` when running the server. For Database schemas, see `prisma/schema.prisma`.

## Overview

The Pear Backend API provides services for User Authentication (OTP-based) and Quote management.

## Authentication

Authentication is handled via Email OTP.

- **POST /api/sentotp**: Request a verification code.
- **POST /api/login**: Login with email and verification code.
- **GET /api/me**: Get current user info (Bear Token required).

## Quote Management

Please refer to the Swagger documentation for the most up-to-date Quote endpoints.
