# #30: Version Management & Rollback

**Versioning Strategy:**
- Semantic versioning: v{major}.{minor}.{patch}
- Git tags: one tag per release
- Release notes: auto-generated from commits
- Docker tags: {version} + latest

**Rollback Procedure:**
```bash
# Get previous version
gh release list | head -5

# Rollback to previous task definition
aws ecs update-service \
  --cluster sss-modernization \
  --service sss-modernization-backend \
  --task-definition sss-modernization-backend:{previous-revision}
  
# Verify rollback
aws ecs wait services-stable
curl https://api.sss-modernization.example.com/api/health
```

**Rollback Criteria:**
- Error rate >5%
- Latency p95 >2000ms
- Data corruption detected
- Authentication broken
- Critical compliance violation

**Version Tracking:**
- Git tags for all releases
- Release notes in GitHub
- Version in /api/health endpoint
- Docker image SHA tracking

**Status:** ✅ COMPLETE
