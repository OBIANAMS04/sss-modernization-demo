/**
 * API Governance Routes
 * Provides endpoints for policy information and rate limit status
 */

import { Router, Request, Response } from 'express';
import { APIGovernanceService } from '../services/apiGovernanceService';
import { authMiddleware } from '../middleware/authMiddleware';
import { Logger } from '../utils/logger';

const router = Router();
const logger = new Logger('GovernanceRoutes');
const governanceService = new APIGovernanceService();

/**
 * GET /governance/policies
 * Get available policies for authenticated user
 */
router.get('/policies', authMiddleware, (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    const policies = {
      user: {
        id: user.id,
        role: user.role,
      },
      available_operations: getPoliciesForRole(user.role),
      rate_limit: governanceService.getRateLimitStatus(user.id, user.role),
    };

    res.json(policies);
  } catch (error) {
    logger.error('Error fetching policies', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /governance/rate-limit
 * Get rate limit status for authenticated user
 */
router.get('/rate-limit', authMiddleware, (req: Request, res: Response) => {
  try {
    const user = req.user as any;
    const status = governanceService.getRateLimitStatus(user.id, user.role);

    res.json({
      rate_limit: status,
      user_role: user.role,
      reset_time: new Date(status.resetTime).toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching rate limit', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /governance/authorize
 * Check if operation would be authorized
 */
router.get('/authorize', authMiddleware, (req: Request, res: Response) => {
  try {
    const { method, path } = req.query as { method: string; path: string };
    const user = req.user as any;

    if (!method || !path) {
      return res.status(400).json({ error: 'method and path query parameters required' });
    }

    const policyRequest = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        authenticated: true,
        mfa_verified: user.mfa_verified,
      },
      method: method.toUpperCase(),
      path,
    };

    governanceService.evaluatePolicy(policyRequest).then((decision) => {
      res.json({
        authorized: decision.allow,
        reason: decision.reason,
        audit_required: decision.audit_required,
      });
    });
  } catch (error) {
    logger.error('Error checking authorization', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /governance/roles
 * List all available roles and their permissions
 */
router.get('/roles', authMiddleware, (req: Request, res: Response) => {
  try {
    const roles = {
      citizen: {
        description: 'Applies for exemptions and tracks application status',
        permissions: [
          { resource: 'exemptions', action: 'read' },
          { resource: 'cases', action: 'read' },
          { resource: 'profile', action: 'read' },
          { resource: 'profile', action: 'update' },
        ],
      },
      case_manager: {
        description: 'Reviews and processes exemption applications',
        permissions: [
          { resource: 'cases', action: 'read' },
          { resource: 'cases', action: 'update' },
          { resource: 'cases', action: 'approve' },
          { resource: 'cases', action: 'deny' },
          { resource: 'case_notes', action: 'create' },
          { resource: 'case_documents', action: 'read' },
        ],
      },
      admin: {
        description: 'Manages system configuration and all users',
        permissions: [
          { resource: 'users', action: 'read' },
          { resource: 'users', action: 'update' },
          { resource: 'users', action: 'delete' },
          { resource: 'cases', action: 'read' },
          { resource: 'cases', action: 'update' },
          { resource: 'cases', action: 'override' },
          { resource: 'compliance', action: 'read' },
          { resource: 'audit', action: 'read' },
          { resource: 'system', action: 'read' },
          { resource: 'system', action: 'update' },
        ],
      },
      leadership: {
        description: 'Views KPIs, metrics, and team performance',
        permissions: [
          { resource: 'cases', action: 'read' },
          { resource: 'metrics', action: 'read' },
          { resource: 'team_performance', action: 'read' },
          { resource: 'compliance', action: 'read' },
          { resource: 'reports', action: 'read' },
        ],
      },
    };

    res.json(roles);
  } catch (error) {
    logger.error('Error fetching roles', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /governance/policy-violations
 * Admin endpoint: List recent policy violations
 */
router.get('/policy-violations', authMiddleware, (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    // Only admins can view violations
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    // In production, query audit log for denied accesses
    const violations = [
      {
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        user_id: 'user123',
        user_role: 'citizen',
        method: 'DELETE',
        path: '/users/456',
        reason: 'Insufficient permissions',
      },
      {
        timestamp: new Date(Date.now() - 1800000).toISOString(),
        user_id: 'user789',
        user_role: 'case_manager',
        method: 'POST',
        path: '/admin/override',
        reason: 'MFA verification required',
      },
    ];

    res.json({
      total_violations: violations.length,
      violations,
      time_window: '1 hour',
    });
  } catch (error) {
    logger.error('Error fetching violations', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Helper function to get policies for a specific role
 */
function getPoliciesForRole(role: string): Record<string, any[]> {
  const policiesByRole: Record<string, Record<string, any[]>> = {
    citizen: {
      GET: ['/exemptions', '/cases'],
      POST: ['/cases'],
      PATCH: [],
    },
    case_manager: {
      GET: ['/cases', '/audit'],
      POST: ['/cases/*/notes'],
      PATCH: ['/cases/*'],
    },
    admin: {
      GET: ['*'],
      POST: ['*'],
      PATCH: ['*'],
      DELETE: ['*'],
      PUT: ['*'],
    },
    leadership: {
      GET: ['/metrics/*', '/reports/*', '/cases', '/compliance', '/audit'],
      POST: [],
      PATCH: [],
    },
  };

  return policiesByRole[role] || { GET: [], POST: [], PATCH: [], DELETE: [], PUT: [] };
}

export const governanceService_export = governanceService;
export default router;
