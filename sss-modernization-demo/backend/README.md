# SSS Modernization Demo - Backend API

Node.js + Express + TypeScript REST API for user registration, authentication, and exemption management.

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 16
- Redis 7

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your database credentials

4. Run migrations:
```bash
npm run migrate
```

5. Start development server:
```bash
npm run dev
```

Server runs on `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start development server (ts-node)
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run compiled JavaScript
- `npm test` - Run Jest tests
- `npm test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint
- `npm run migrate` - Run database migrations

## API Endpoints

### Authentication

**POST /auth/register**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "fullName": "John Doe",
  "ssn": "123-45-6789",
  "dob": "1990-01-01"
}
```

Response (201):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe"
  },
  "token": "eyJhbGc..."
}
```

**POST /auth/login**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

Response (200):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe"
  },
  "token": "eyJhbGc..."
}
```

**GET /health**

Response (200):
```json
{
  "status": "ok",
  "timestamp": "2026-01-01T12:00:00Z",
  "database": "connected"
}
```

## Project Structure

```
backend/
├── src/
│   ├── database/
│   │   ├── migrations/    # SQL migrations
│   │   ├── connection.ts  # PostgreSQL connection pool
│   │   └── migrate.ts     # Migration runner
│   ├── middleware/        # Express middleware
│   ├── routes/            # API route handlers
│   ├── services/          # Business logic
│   ├── utils/             # Utilities (JWT, validation, errors)
│   ├── app.ts            # Express app setup
│   └── index.ts          # Server entry point
├── package.json
├── tsconfig.json
├── jest.config.js
└── .env.example
```

## Database Schema

### users
- `id` (UUID, primary key)
- `email` (VARCHAR 255, unique)
- `password_hash` (VARCHAR 255)
- `full_name` (VARCHAR 255)
- `ssn` (VARCHAR 11)
- `dob` (DATE)
- `phone` (VARCHAR 20)
- `address` (TEXT)
- `mfa_enabled` (BOOLEAN, default: false)
- `compliance_status` (VARCHAR 50)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

## Password Requirements

- Minimum 12 characters
- At least 1 uppercase letter
- At least 1 digit
- At least 1 special character (!@#$%^&*)

## SSN Format

- Format: XXX-XX-XXXX
- Example: 123-45-6789

## Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm test:watch
```

Tests cover:
- User registration (valid/invalid inputs)
- Email uniqueness
- Password validation
- SSN validation
- Age validation (must be 18+)
- User login
- Error handling

## Security

- Passwords hashed with bcrypt (12 rounds)
- JWT tokens (HS256)
- Input validation on all routes
- CORS configured
- Rate limiting (via middleware, to be added)
- SQL injection prevention (parameterized queries)

## Development

### Adding a new route

1. Create file in `src/routes/`
2. Define route handlers
3. Add route to `src/app.ts`
4. Add tests in route file (`.test.ts`)

### Adding a new database table

1. Create migration SQL in `src/database/migrations/`
2. Update `src/database/migrate.ts` to include new migration
3. Run `npm run migrate`

## Troubleshooting

**Database connection error:**
- Check `.env` DATABASE_* variables
- Ensure PostgreSQL is running
- Verify credentials

**Port 3001 already in use:**
- Change `PORT` in `.env`
- Or kill process: `lsof -ti:3001 | xargs kill -9`

**TypeScript errors:**
- Run `npm install` to update dependencies
- Run `npm run build` to check for compilation errors
