/**
 * API Governance Service
 * Enforces OPA (Open Policy Agent) policies for role-based and attribute-based access control
 */

import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';

const logger = new Logger('APIGovernanceService');

export interface PolicyRequest {
  user: {
    id: string;
    email: string;
    role: string;
    authenticated: boolean;
    mfa_verified?: boolean;
  };
  method: string;
  path: string;
  body?: Record<string, any>;
  accessing_resource?: string;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  audit_required: boolean;
}

export interface RateLimitConfig {
  citizen: number; // 60 req/min
  case_manager: number; // 300 req/min
  admin: number; // 1000 req/min
}

export class APIGovernanceService {
  private readonly rateLimits: RateLimitConfig = {
    citizen: 60,
    case_manager: 300,
    admin: 1000,
  };

  private readonly requestCounts = new Map<string, { count: number; resetTime: number }>();

  /**
   * Evaluate OPA policy for a request
   */
  async evaluatePolicy(req: PolicyRequest): Promise<PolicyDecision> {
    const { user, method, path } = req;

    // Admin bypass (except for sensitive operations)
    if (user.role === 'admin' && !this.isSensitiveOperation(method, path)) {
      return {
        allow: true,
        reason: 'Admin bypass',
        audit_required: this.isAuditRequired(method, path),
      };
    }

    // Route-based access control
    if (method === 'GET' && path === '/exemptions') {
      if (user.role === 'citizen') {
        // Citizens can only list their own exemptions
        return {
          allow: true,
          reason: 'Citizen read exemptions',
          audit_required: false,
        };
      }
    }

    if (method === 'POST' && path === '/cases') {
      if (user.role === 'citizen') {
        return {
          allow: true,
          reason: 'Citizen create case',
          audit_required: this.isAuditRequired(method, path),
        };
      }
    }

    if (method === 'GET' && path.startsWith('/cases')) {
      if (user.role === 'citizen' || user.role === 'case_manager' || user.role === 'admin') {
        return {
          allow: true,
          reason: `${user.role} read cases`,
          audit_required: false,
        };
      }
    }

    if (method === 'PATCH' && path.startsWith('/cases')) {
      if (user.role === 'case_manager' || user.role === 'admin') {
        return {
          allow: true,
          reason: `${user.role} update case`,
          audit_required: this.isAuditRequired(method, path),
        };
      }
    }

    if (method === 'POST' && path.includes('/notes')) {
      if (user.role === 'case_manager' || user.role === 'admin') {
        return {
          allow: true,
          reason: `${user.role} create note`,
          audit_required: this.isAuditRequired(method, path),
        };
      }
    }

    if (method === 'GET' && path === '/audit') {
      if (user.role === 'case_manager' || user.role === 'admin' || user.role === 'leadership') {
        return {
          allow: true,
          reason: `${user.role} read audit logs`,
          audit_required: false,
        };
      }
    }

    if (method === 'GET' && (path.startsWith('/metrics') || path.startsWith('/reports'))) {
      if (user.role === 'leadership' || user.role === 'admin') {
        return {
          allow: true,
          reason: `${user.role} read analytics`,
          audit_required: false,
        };
      }
    }

    if (method === 'GET' && path === '/compliance/matrix') {
      if (user.authenticated) {
        return {
          allow: true,
          reason: 'Authenticated compliance read',
          audit_required: false,
        };
      }
    }

    if (path.startsWith('/admin/override') || (method === 'DELETE' && path.startsWith('/users'))) {
      if (user.authenticated && user.mfa_verified) {
        return {
          allow: true,
          reason: 'MFA-verified admin operation',
          audit_required: true,
        };
      }
      return {
        allow: false,
        reason: 'MFA verification required',
        audit_required: true,
      };
    }

    return {
      allow: false,
      reason: `Insufficient permissions for ${user.role} on ${method} ${path}`,
      audit_required: this.isAuditRequired(method, path),
    };
  }

  /**
   * Check if operation requires audit logging
   */
  private isAuditRequired(method: string, path: string): boolean {
    const auditMethods = ['DELETE', 'POST', 'PATCH', 'PUT'];
    const auditPaths = ['/admin', '/users', 'override'];

    return (
      auditMethods.includes(method) || auditPaths.some((p) => path.includes(p))
    );
  }

  /**
   * Check if operation is sensitive (requires additional validation)
   */
  private isSensitiveOperation(method: string, path: string): boolean {
    return (
      method === 'DELETE' ||
      path.startsWith('/admin') ||
      path.includes('/users') ||
      path.includes('override')
    );
  }

  /**
   * Check rate limit for a user
   */
  isRateLimited(userId: string, userRole: string): boolean {
    const limit = this.rateLimits[userRole as keyof RateLimitConfig] || 60;
    const now = Date.now();
    const oneMinute = 60 * 1000;

    const entry = this.requestCounts.get(userId);

    if (!entry || now > entry.resetTime) {
      // Reset counter
      this.requestCounts.set(userId, { count: 1, resetTime: now + oneMinute });
      return false;
    }

    if (entry.count >= limit) {
      return true;
    }

    entry.count++;
    return false;
  }

  /**
   * Get rate limit status for user
   */
  getRateLimitStatus(userId: string, userRole: string): { remaining: number; limit: number; resetTime: number } {
    const limit = this.rateLimits[userRole as keyof RateLimitConfig] || 60;
    const entry = this.requestCounts.get(userId);

    if (!entry) {
      return { remaining: limit, limit, resetTime: Date.now() + 60 * 1000 };
    }

    return {
      remaining: Math.max(0, limit - entry.count),
      limit,
      resetTime: entry.resetTime,
    };
  }

  /**
   * Cleanup rate limit entries periodically
   */
  cleanupRateLimitCache(): void {
    const now = Date.now();
    for (const [userId, entry] of this.requestCounts.entries()) {
      if (now > entry.resetTime) {
        this.requestCounts.delete(userId);
      }
    }
    logger.info('Rate limit cache cleaned up');
  }
}

/**
 * Express middleware for API governance
 */
export function apiGovernanceMiddleware(service: APIGovernanceService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;

      if (!user) {
        return res.status(401).json({ error: 'Unauthenticated' });
      }

      // Rate limiting check
      if (service.isRateLimited(user.id, user.role)) {
        const rateLimitStatus = service.getRateLimitStatus(user.id, user.role);
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil((rateLimitStatus.resetTime - Date.now()) / 1000),
        });
      }

      // Policy evaluation
      const policyRequest: PolicyRequest = {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          authenticated: true,
          mfa_verified: user.mfa_verified,
        },
        method: req.method,
        path: req.path,
        body: req.body,
      };

      const decision = await service.evaluatePolicy(policyRequest);

      if (!decision.allow) {
        logger.warn(`Policy denied: ${decision.reason} for user ${user.id} on ${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Access denied', reason: decision.reason });
      }

      // Attach governance context to request
      (req as any).governance = {
        auditRequired: decision.audit_required,
        policyDecision: decision,
      };

      const rateLimitStatus = service.getRateLimitStatus(user.id, user.role);
      res.set('X-RateLimit-Remaining', String(rateLimitStatus.remaining));
      res.set('X-RateLimit-Limit', String(rateLimitStatus.limit));
      res.set('X-RateLimit-Reset', String(rateLimitStatus.resetTime));

      next();
    } catch (error) {
      logger.error('Policy evaluation failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export default APIGovernanceService;
