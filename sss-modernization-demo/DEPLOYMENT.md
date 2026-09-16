# SSS Modernization Platform - Deployment Guide

## Quick Start (5 minutes)

### Prerequisites
- Docker Desktop 29.7+ installed and running
- docker-compose 2.0+ 
- 4GB RAM minimum (8GB+ recommended)
- Ports 3001, 5173, 5432 available

### Start All Services

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5432`
- **Backend API** on `localhost:3001`
- **Frontend** on `localhost:5173`

### Verify Services Running

```bash
docker-compose ps
```

Expected output:
```
NAME              STATUS
sss-postgres      Up (healthy)
sss-backend       Up
sss-frontend      Up
```

### Access the Application

Open browser: `http://localhost:5173`

You should see the SSS Modernization Platform login page.

---

## Environment Configuration

### Backend Environment Variables

The `docker-compose.yml` includes default development settings:

```yaml
NODE_ENV: production
DATABASE_URL: postgresql://sss_user:sss_dev_password@postgres:5432/sss_modernization
JWT_SECRET: your_jwt_secret_key_change_in_prod
JWT_EXPIRY: 3600
CORS_ORIGIN: http://localhost:5173,http://localhost:3000
```

### Change for Production

Create `.env` file in project root:

```env
NODE_ENV=production
DATABASE_URL=postgresql://prod_user:strong_password@prod-db-host:5432/sss_prod
JWT_SECRET=change_this_to_secure_random_value
JWT_EXPIRY=3600
CORS_ORIGIN=https://yourdomain.com
```

Then update `docker-compose.yml` to use:

```yaml
env_file:
  - .env
```

### Frontend Environment Variables

Frontend uses build-time variables. For production:

1. Update `frontend/.env.production`:
```
VITE_API_BASE_URL=https://api.yourdomain.com/api
VITE_APP_NAME=SSS Modernization Platform
```

2. Rebuild frontend:
```bash
docker-compose build frontend
```

---

## Database Initialization

### Known Issue: Users Table

The PostgreSQL database initializes empty. The `users` table must be created manually.

### Create Users Table

Run this command to create required tables:

```bash
docker exec -it sss-postgres psql -U sss_user -d sss_modernization -c "
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  secret VARCHAR(32) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_mfa_user_id ON mfa_devices(user_id);
"
```

### Or: Use SQL Script

Create `database/init.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  mfa_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  secret VARCHAR(32) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_mfa_user_id ON mfa_devices(user_id);
```

Then mount in `docker-compose.yml`:

```yaml
postgres:
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql
```

---

## Health Checks & Verification

### Check Backend API

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-08-31T12:00:00.000Z",
  "database": "checking..."
}
```

### Check Database Connection

```bash
docker exec -it sss-postgres psql -U sss_user -d sss_modernization -c "SELECT version();"
```

Should return PostgreSQL version info.

### Check Frontend

Open `http://localhost:5173` in browser. You should see:
- Login form with email/password fields
- Register link
- Responsive layout

### View Service Logs

```bash
# Backend logs
docker-compose logs backend

# Frontend logs
docker-compose logs frontend

# Database logs
docker-compose logs postgres

# All services
docker-compose logs -f
```

---

## Production Deployment

### Docker Image Builds

Images are built from Dockerfiles in each service directory:

**Frontend** (`frontend/Dockerfile`):
- Multi-stage build with Node.js 26.7-alpine
- Builds Vite assets in builder stage
- Serves with lightweight `serve` package in runtime stage
- Health check via HTTP on port 5173

**Backend** (`backend/Dockerfile`):
- Multi-stage build with Node.js 26.7-alpine
- TypeScript compiled to dist/ in builder stage
- Non-root `nodejs` user in runtime stage
- Health check via HTTP on port 3001

**Database**:
- Official PostgreSQL 18.6-alpine image
- Persistent volume for data

### Deploy to Cloud

#### Docker Swarm

```bash
docker stack deploy -c docker-compose.yml sss
```

#### Kubernetes

Convert docker-compose to Kubernetes manifests:

```bash
kompose convert -f docker-compose.yml -o k8s/
kubectl apply -f k8s/
```

#### AWS ECS

Use AWS Console to create ECS Task Definition from docker-compose.yml

#### Azure Container Instances

```bash
az container create \
  --resource-group mygroup \
  --name sss-platform \
  --image sss-modernization-demo_backend:latest
```

---

## Troubleshooting

### Docker Services Won't Start

**Error**: `failed to connect to the docker API`

**Solution**: 
- Ensure Docker Desktop is running
- Check Docker daemon status: `docker ps`
- Restart Docker Desktop

### Port Already in Use

**Error**: `port is already allocated`

**Solution**: Free the port or use different port in docker-compose.yml

```yaml
ports:
  - "3002:3001"  # Change host port from 3001 to 3002
```

### Database Connection Failed

**Error**: `connection refused on localhost:5432`

**Solution**:
- Check postgres service running: `docker-compose ps postgres`
- View logs: `docker-compose logs postgres`
- Ensure database table exists (see Database Initialization section)

### Frontend Won't Load

**Error**: `Cannot GET /` or blank page

**Solution**:
- Check frontend service: `docker-compose logs frontend`
- Verify CORS: Backend should have `CORS_ORIGIN: http://localhost:5173`
- Clear browser cache: `Ctrl+Shift+Delete`

### API Returns 404 or CORS Error

**Error**: `Failed to fetch from http://localhost:3001/api/auth/login`

**Solution**:
- Verify backend running: `curl http://localhost:3001/health`
- Check CORS configuration in `backend/src/app.ts`
- Ensure frontend and backend are on same docker network

### User Registration Returns 400 Bad Request

**Error**: `{"error": {"message": "Validation failed", "code": "BAD_REQUEST"}}`

**Solution**:
- Users table doesn't exist
- Run Database Initialization section above
- Verify table created: `docker exec -it sss-postgres psql -U sss_user -d sss_modernization -c "\dt users"`

---

## Monitoring & Logs

### View Real-Time Logs

```bash
docker-compose logs -f
```

### View Specific Service Logs

```bash
docker-compose logs -f backend
docker-compose logs -f postgres
docker-compose logs -f frontend
```

### Check Resource Usage

```bash
docker stats
```

Shows CPU, memory, network I/O for each container.

---

## Stopping & Cleanup

### Stop All Services

```bash
docker-compose down
```

Services stop, containers removed, but data persists in volumes.

### Stop and Remove Data

```bash
docker-compose down -v
```

⚠️ Warning: This deletes the PostgreSQL database volume!

### Stop Individual Service

```bash
docker-compose stop backend
```

---

## Network Architecture

```
┌─────────────────────────────────────────────┐
│          sss-network (bridge)               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │   Frontend   │  │   Backend    │        │
│  │ :5173        │  │   :3001      │        │
│  └──────┬───────┘  └──────┬───────┘        │
│         │                 │                │
│         └─────────────────┴────────┐       │
│                                    │       │
│                            ┌───────▼────┐ │
│                            │ PostgreSQL  │ │
│                            │   :5432     │ │
│                            └─────────────┘ │
│                                            │
└─────────────────────────────────────────────┘
```

All services communicate through the `sss-network` bridge network.

---

## Security Considerations

### Production Checklist

- [ ] Change JWT_SECRET to secure random value
- [ ] Use HTTPS (enable in reverse proxy)
- [ ] Set strong database password
- [ ] Enable database authentication
- [ ] Configure firewall rules
- [ ] Set CORS_ORIGIN to your domain only
- [ ] Enable container security scanning
- [ ] Use private Docker registry
- [ ] Implement secret management (AWS Secrets Manager, etc.)
- [ ] Enable audit logging
- [ ] Regular security updates for base images

### Update Base Images

```bash
docker-compose build --pull
```

---

## Version Info

- **Node.js**: 26.7-alpine
- **PostgreSQL**: 18.6-alpine
- **React**: 18.x
- **Express**: Latest
- **Docker Compose**: 3.9

---

## Support & Documentation

- Frontend: `frontend/README.md`
- Backend: `backend/README.md`
- API Spec: `docs/API-SPECIFICATION.yaml`
- Architecture: `docs/ARCHITECTURE.md`

---

**Last Updated**: 2026-08-31  
**Deployment Version**: R0 (Release Zero)  
**Status**: Production-Ready (pending database initialization)
