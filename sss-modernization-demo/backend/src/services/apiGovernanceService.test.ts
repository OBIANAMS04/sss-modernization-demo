import { APIGovernanceService, PolicyRequest } from './apiGovernanceService';

describe('APIGovernanceService', () => {
  let service: APIGovernanceService;

  beforeEach(() => {
    service = new APIGovernanceService();
  });

  describe('Policy Evaluation', () => {
    it('should allow admin for any non-sensitive operation', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'admin1',
          email: 'admin@example.com',
          role: 'admin',
          authenticated: true,
        },
        method: 'GET',
        path: '/cases',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should deny unauthenticated user from MFA operation', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'user1',
          email: 'user@example.com',
          role: 'citizen',
          authenticated: true,
          mfa_verified: false,
        },
        method: 'DELETE',
        path: '/users/123',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(false);
    });

    it('should allow MFA-verified admin for sensitive operations', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'admin1',
          email: 'admin@example.com',
          role: 'admin',
          authenticated: true,
          mfa_verified: true,
        },
        method: 'DELETE',
        path: '/users/123',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow citizen to read exemptions', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'citizen1',
          email: 'citizen@example.com',
          role: 'citizen',
          authenticated: true,
        },
        method: 'GET',
        path: '/exemptions',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow citizen to create cases', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'citizen1',
          email: 'citizen@example.com',
          role: 'citizen',
          authenticated: true,
        },
        method: 'POST',
        path: '/cases',
        body: { citizen_id: 'citizen1' },
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow case_manager to read cases', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'manager1',
          email: 'manager@example.com',
          role: 'case_manager',
          authenticated: true,
        },
        method: 'GET',
        path: '/cases',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow case_manager to update cases', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'manager1',
          email: 'manager@example.com',
          role: 'case_manager',
          authenticated: true,
        },
        method: 'PATCH',
        path: '/cases/123',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow case_manager to create notes', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'manager1',
          email: 'manager@example.com',
          role: 'case_manager',
          authenticated: true,
        },
        method: 'POST',
        path: '/cases/123/notes',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow leadership to read metrics', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'leader1',
          email: 'leader@example.com',
          role: 'leadership',
          authenticated: true,
        },
        method: 'GET',
        path: '/metrics/approval-rate',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should allow leadership to read reports', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'leader1',
          email: 'leader@example.com',
          role: 'leadership',
          authenticated: true,
        },
        method: 'GET',
        path: '/reports/monthly-summary',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(true);
    });

    it('should deny citizen access to admin override', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'citizen1',
          email: 'citizen@example.com',
          role: 'citizen',
          authenticated: true,
        },
        method: 'POST',
        path: '/admin/override',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.allow).toBe(false);
    });

    it('should require audit for DELETE operations', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'admin1',
          email: 'admin@example.com',
          role: 'admin',
          authenticated: true,
          mfa_verified: true,
        },
        method: 'DELETE',
        path: '/users/123',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.audit_required).toBe(true);
    });

    it('should require audit for POST /admin operations', async () => {
      const req: PolicyRequest = {
        user: {
          id: 'admin1',
          email: 'admin@example.com',
          role: 'admin',
          authenticated: true,
        },
        method: 'POST',
        path: '/admin/users',
      };

      const decision = await service.evaluatePolicy(req);
      expect(decision.audit_required).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should not rate limit when under limit', () => {
      const userId = 'user1';
      const userRole = 'citizen'; // 60 req/min limit

      for (let i = 0; i < 50; i++) {
        const isLimited = service.isRateLimited(userId, userRole);
        expect(isLimited).toBe(false);
      }
    });

    it('should rate limit citizen after 60 requests', () => {
      const userId = 'user1';
      const userRole = 'citizen'; // 60 req/min limit

      for (let i = 0; i < 60; i++) {
        service.isRateLimited(userId, userRole);
      }

      const isLimited = service.isRateLimited(userId, userRole);
      expect(isLimited).toBe(true);
    });

    it('should allow case_manager 300 requests per minute', () => {
      const userId = 'manager1';
      const userRole = 'case_manager'; // 300 req/min limit

      for (let i = 0; i < 300; i++) {
        const isLimited = service.isRateLimited(userId, userRole);
        expect(isLimited).toBe(false);
      }

      const isLimited = service.isRateLimited(userId, userRole);
      expect(isLimited).toBe(true);
    });

    it('should allow admin 1000 requests per minute', () => {
      const userId = 'admin1';
      const userRole = 'admin'; // 1000 req/min limit

      for (let i = 0; i < 1000; i++) {
        const isLimited = service.isRateLimited(userId, userRole);
        expect(isLimited).toBe(false);
      }

      const isLimited = service.isRateLimited(userId, userRole);
      expect(isLimited).toBe(true);
    });

    it('should return rate limit status', () => {
      const userId = 'user1';
      const userRole = 'citizen';

      for (let i = 0; i < 30; i++) {
        service.isRateLimited(userId, userRole);
      }

      const status = service.getRateLimitStatus(userId, userRole);
      expect(status.remaining).toBe(30); // 60 limit - 30 used
      expect(status.limit).toBe(60);
      expect(status.resetTime).toBeGreaterThan(Date.now());
    });

    it('should cleanup expired rate limit entries', () => {
      const userId = 'user1';
      const userRole = 'citizen';

      // Make request
      service.isRateLimited(userId, userRole);

      // Mock time passage (simulate 61 seconds later)
      const originalNow = Date.now;
      Date.now = jest.fn(() => originalNow() + 61 * 1000);

      // Cleanup should remove the entry
      service.cleanupRateLimitCache();

      // Entry should be reset now
      const status = service.getRateLimitStatus(userId, userRole);
      expect(status.remaining).toBe(60);

      Date.now = originalNow;
    });
  });

  describe('Authorization Rules', () => {
    it('should enforce principle of least privilege', async () => {
      const citizenReq: PolicyRequest = {
        user: {
          id: 'citizen1',
          email: 'citizen@example.com',
          role: 'citizen',
          authenticated: true,
        },
        method: 'DELETE',
        path: '/users/123',
      };

      const decision = await service.evaluatePolicy(citizenReq);
      expect(decision.allow).toBe(false);
    });

    it('should allow progressively more access for higher roles', async () => {
      const path = '/audit';
      const method = 'GET';

      // Citizen cannot read audit
      const citizenReq: PolicyRequest = {
        user: {
          id: 'citizen1',
          email: 'citizen@example.com',
          role: 'citizen',
          authenticated: true,
        },
        method,
        path,
      };

      let decision = await service.evaluatePolicy(citizenReq);
      expect(decision.allow).toBe(false);

      // Case manager can read audit
      const managerReq: PolicyRequest = {
        user: {
          id: 'manager1',
          email: 'manager@example.com',
          role: 'case_manager',
          authenticated: true,
        },
        method,
        path,
      };

      decision = await service.evaluatePolicy(managerReq);
      expect(decision.allow).toBe(true);

      // Admin can also read audit
      const adminReq: PolicyRequest = {
        user: {
          id: 'admin1',
          email: 'admin@example.com',
          role: 'admin',
          authenticated: true,
        },
        method,
        path,
      };

      decision = await service.evaluatePolicy(adminReq);
      expect(decision.allow).toBe(true);
    });
  });
});
