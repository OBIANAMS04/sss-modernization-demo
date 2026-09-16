# SSS Modernization Platform - Frontend

React 18 + Vite + Tailwind CSS frontend for the SSS Modernization Platform Release Zero (R0).

## Overview

This is a modern, responsive frontend application built with:
- **React 18** - UI library
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **Tailwind CSS** - Utility-first CSS framework
- **JWT Authentication** - Secure token-based auth

## Project Structure

```
src/
├── components/
│   ├── Auth/
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   └── ProtectedRoute.jsx
│   └── Dashboard/
│       ├── Dashboard.jsx
│       └── UserProfile.jsx
├── services/
│   ├── api.js
│   └── authService.js
├── hooks/
│   ├── useAuth.js
│   └── useApi.js
├── utils/
│   ├── tokenManager.js
│   └── validators.js
├── App.jsx
├── main.jsx
└── index.css
```

## Setup & Installation

### Prerequisites
- Node.js v16+
- npm v8+

### Installation

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

## Features

- User Registration & Login
- JWT Authentication
- Protected Dashboard
- User Profile Management
- Responsive Design
- Form Validation
- API Integration

## API Configuration

Set `VITE_API_BASE_URL` in `.env.local`:
```
VITE_API_BASE_URL=http://localhost:3001/api
```

## Authentication

Login flow:
1. Register or login
2. JWT token stored in localStorage
3. Token included in API requests
4. Automatic logout on 401 response

## Deployment

```bash
npm run build
# Deploy dist/ directory
```

## Security

- JWT token-based authentication
- Password validation (min 6 chars)
- Email format validation
- Protected routes
- CORS-enabled API integration

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
