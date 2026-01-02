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

- **GET /api/quotes**: List all quotes for the current user.
- **POST /api/quotes**: Create a new quote.
- **GET /api/quotes/:id**: Get a specific quote.
- **PUT /api/quotes/:id**: Update a specific quote.
- **DELETE /api/quotes/:id**: Delete a specific quote.

## Customer Management

- **GET /api/customers**: List all customers.
- **POST /api/customers**: Create a new customer.
- **GET /api/customers/:id**: Get a specific customer.
- **PUT /api/customers/:id**: Update a specific customer.
- **DELETE /api/customers/:id**: Delete a specific customer.

## Settings Management

- **GET /api/settings**: Get system settings.
- **PUT /api/settings**: Update system settings.

Please refer to the Swagger documentation (`openapi.yaml`) for the detailed schema and parameters.
