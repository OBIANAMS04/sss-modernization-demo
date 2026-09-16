/**
 * Analytics Routes
 * Leadership-level business intelligence and reporting
 * Requires: 'leadership' role for all endpoints
 */

import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { Case, Exemption, ComplianceCheck, User } from '../models';

const router = Router();

// Middleware: Verify leadership role
const requireLeadership = authorize(['leadership']);

/**
 * GET /api/analytics/cases
 * Case statistics and trends
 */
router.get('/cases', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '30days';
    const startDate = getStartDate(range);

    // Total cases
    const totalCases = await Case.query().count('* as count').first();

    // Cases by status
    const casesByStatus = await Case.query()
      .select('status')
      .count('* as count')
      .where('createdAt', '>=', startDate)
      .groupBy('status');

    // Average time to approval
    const approvalTimes = await Case.query()
      .select('approvedAt', 'createdAt')
      .where('status', 'APPROVED')
      .where('createdAt', '>=', startDate);

    const avgTimeMs = approvalTimes.reduce((acc, c) => {
      const time = new Date(c.approvedAt).getTime() - new Date(c.createdAt).getTime();
      return acc + time;
    }, 0) / (approvalTimes.length || 1);

    // Approval rate
    const approvedCount = approvalTimes.length;
    const totalInRange = await Case.query()
      .where('createdAt', '>=', startDate)
      .count('* as count')
      .first();
    const approvalRate = (approvedCount / (totalInRange?.count || 1)) * 100;

    // Trends over time (daily)
    const trends = await Case.query()
      .select('createdAt')
      .count('* as count')
      .where('createdAt', '>=', startDate)
      .groupByRaw(`DATE(createdAt)`)
      .orderBy('createdAt', 'asc');

    const trendsOverTime = trends.map(t => ({
      date: new Date(t.createdAt).toISOString().split('T')[0],
      count: t.count
    }));

    res.json({
      totalCases: totalCases?.count || 0,
      casesByStatus,
      averageTimeToApproval: Math.round(avgTimeMs / 1000 / 60 / 60 / 24), // Convert to days
      approvalRate,
      trendsOverTime
    });
  } catch (error) {
    console.error('Failed to fetch case analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/exemptions
 * Exemption statistics and trends
 */
router.get('/exemptions', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '30days';
    const startDate = getStartDate(range);

    // Total exemptions checked
    const totalChecked = await Exemption.query()
      .where('createdAt', '>=', startDate)
      .count('* as count')
      .first();

    // Total exemptions approved (eligible = true)
    const totalApproved = await Exemption.query()
      .where('eligible', true)
      .where('createdAt', '>=', startDate)
      .count('* as count')
      .first();

    // Approval rate
    const approvalRate = ((totalApproved?.count || 0) / (totalChecked?.count || 1)) * 100;

    // By type (Type A, Type B, Type C)
    const byType = await Exemption.query()
      .select('exemptions')
      .where('createdAt', '>=', startDate)
      .groupByRaw('exemptions')
      .count('* as count');

    // Average check time
    const checkTimes = await Exemption.query()
      .select('createdAt')
      .where('createdAt', '>=', startDate)
      .limit(100);

    const avgCheckTime = checkTimes.length > 0
      ? checkTimes.reduce((acc, t) => acc + new Date(t.createdAt).getTime(), 0) / checkTimes.length
      : 0;

    res.json({
      totalChecked: totalChecked?.count || 0,
      totalApproved: totalApproved?.count || 0,
      approvalRate,
      byType,
      averageCheckTime: Math.round(avgCheckTime / 1000) // Convert to seconds
    });
  } catch (error) {
    console.error('Failed to fetch exemption analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/compliance
 * Compliance status and metrics
 */
router.get('/compliance', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '30days';
    const startDate = getStartDate(range);

    // Get all compliance checks in range
    const checks = await ComplianceCheck.query()
      .where('timestamp', '>=', startDate);

    // Overall score (% of PASS checks)
    const passCount = checks.filter(c => c.status === 'PASS').length;
    const overallScore = (passCount / (checks.length || 1)) * 100;

    // By requirement
    const byRequirement = {} as Record<string, { pass: number; fail: number; pending: number }>;
    checks.forEach(check => {
      if (!byRequirement[check.requirement]) {
        byRequirement[check.requirement] = { pass: 0, fail: 0, pending: 0 };
      }
      byRequirement[check.requirement][check.status.toLowerCase()]++;
    });

    const requirements = Object.entries(byRequirement).map(([name, counts]) => ({
      name,
      score: (counts.pass / (counts.pass + counts.fail + counts.pending || 1)) * 100
    }));

    // Breaches
    const breaches = checks.filter(c => c.status === 'FAIL').length;

    res.json({
      overallScore,
      requirements,
      breaches,
      lastChecked: checks.length > 0 ? checks[checks.length - 1].timestamp : null
    });
  } catch (error) {
    console.error('Failed to fetch compliance analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/budget
 * Cost and budget analytics
 */
router.get('/budget', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '30days';

    // Simulated cost data (would come from AWS Cost Explorer in production)
    const costData = {
      totalCost: 4250.75,
      monthlyTrend: [
        { month: 'Jun', cost: 3800 },
        { month: 'Jul', cost: 4100 },
        { month: 'Aug', cost: 4250 }
      ],
      costByService: [
        { service: 'ECS', cost: 1200 },
        { service: 'RDS', cost: 1500 },
        { service: 'ElastiCache', cost: 400 },
        { service: 'ALB', cost: 300 },
        { service: 'Data Transfer', cost: 200 },
        { service: 'Other', cost: 250 }
      ],
      yearlySavings: 1800 // From optimization recommendations
    };

    res.json(costData);
  } catch (error) {
    console.error('Failed to fetch budget analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/users
 * User activity and engagement
 */
router.get('/users', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '30days';
    const startDate = getStartDate(range);

    // Active users by role
    const activeUsers = await User.query()
      .select('role')
      .count('* as count')
      .where('lastLogin', '>=', startDate)
      .groupBy('role');

    // Session duration tracking (would need session model in production)
    const avgSessionDuration = 1200; // 20 minutes (mock data)

    // Feature usage (would need event tracking in production)
    const featureUsage = [
      { feature: 'Create Case', count: 1250 },
      { feature: 'Check Exemption', count: 3400 },
      { feature: 'View Dashboard', count: 5200 },
      { feature: 'Export Report', count: 320 }
    ];

    res.json({
      activeUsers,
      avgSessionDuration,
      featureUsage
    });
  } catch (error) {
    console.error('Failed to fetch user analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/analytics/export
 * Export analytics report in various formats
 */
router.get('/export/:format', authenticate, requireLeadership, async (req: Request, res: Response) => {
  try {
    const { format } = req.params;
    const range = (req.query.range as string) || '30days';

    if (!['pdf', 'csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    // Fetch all analytics data
    const startDate = getStartDate(range);

    const analyticsData = {
      generatedAt: new Date().toISOString(),
      range,
      cases: await fetchCaseAnalytics(startDate),
      exemptions: await fetchExemptionAnalytics(startDate),
      compliance: await fetchComplianceAnalytics(startDate)
    };

    // Format response based on requested format
    if (format === 'json') {
      res.json(analyticsData);
    } else if (format === 'csv') {
      const csv = convertToCSV(analyticsData);
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename="analytics.csv"');
      res.send(csv);
    } else if (format === 'pdf') {
      // Would use a PDF library like PDFKit in production
      res.status(501).json({ error: 'PDF export coming soon' });
    }
  } catch (error) {
    console.error('Failed to export analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Helper function to get start date based on range
 */
function getStartDate(range: string): Date {
  const now = new Date();
  const start = new Date();

  switch (range) {
    case '7days':
      start.setDate(start.getDate() - 7);
      break;
    case '30days':
      start.setDate(start.getDate() - 30);
      break;
    case '90days':
      start.setDate(start.getDate() - 90);
      break;
    case '1year':
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'ytd':
      start.setMonth(0);
      start.setDate(1);
      break;
    default:
      start.setDate(start.getDate() - 30);
  }

  return start;
}

/**
 * Helper functions for fetching analytics data
 */
async function fetchCaseAnalytics(startDate: Date) {
  const totalCases = await Case.query().count('* as count').first();
  const casesByStatus = await Case.query()
    .select('status')
    .count('* as count')
    .where('createdAt', '>=', startDate)
    .groupBy('status');

  return { totalCases: totalCases?.count || 0, casesByStatus };
}

async function fetchExemptionAnalytics(startDate: Date) {
  const totalChecked = await Exemption.query()
    .where('createdAt', '>=', startDate)
    .count('* as count')
    .first();

  return { totalChecked: totalChecked?.count || 0 };
}

async function fetchComplianceAnalytics(startDate: Date) {
  const checks = await ComplianceCheck.query()
    .where('timestamp', '>=', startDate);

  const passCount = checks.filter(c => c.status === 'PASS').length;
  const score = (passCount / (checks.length || 1)) * 100;

  return { score, totalChecks: checks.length };
}

/**
 * Convert analytics data to CSV format
 */
function convertToCSV(data: any): string {
  const lines: string[] = [];

  lines.push('Analytics Report');
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(`Range: ${data.range}`);
  lines.push('');

  // Cases section
  lines.push('CASE STATISTICS');
  lines.push(`Total Cases,${data.cases.totalCases}`);
  lines.push('Status,Count');
  data.cases.casesByStatus.forEach((stat: any) => {
    lines.push(`${stat.status},${stat.count}`);
  });
  lines.push('');

  // Exemptions section
  lines.push('EXEMPTION STATISTICS');
  lines.push(`Total Checked,${data.exemptions.totalChecked}`);
  lines.push('');

  // Compliance section
  lines.push('COMPLIANCE SCORE');
  lines.push(`Overall Score,${data.compliance.score.toFixed(2)}%`);
  lines.push(`Total Checks,${data.compliance.totalChecks}`);

  return lines.join('\n');
}

export default router;
