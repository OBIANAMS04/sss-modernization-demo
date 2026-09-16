import pool from '../database/connection';

export interface LatencyMetric {
  id: number;
  entityType: string;
  operation: string;
  latencyMs: number;
  timestamp: string;
}

export interface LatencyStats {
  entityType: string;
  operation: string;
  count: number;
  minLatency: number;
  maxLatency: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  withinSLO: number;
  sloViolationRate: number;
}

export interface AggregatedMetrics {
  period: { startTime: string; endTime: string; hours: number };
  globalStats: {
    totalOperations: number;
    operationsWithinSLO: number;
    globalSLORate: number;
  };
  byEntity: LatencyStats[];
}

const SLO_TARGET_MS = 30000; // 30 seconds

export async function logLatency(
  entityType: string,
  operation: string,
  latencyMs: number
): Promise<LatencyMetric> {
  const result = await pool.query(
    `INSERT INTO latency_metrics (entity_type, operation, latency_ms)
     VALUES ($1, $2, $3)
     RETURNING id, entity_type, operation, latency_ms, timestamp`,
    [entityType, operation, latencyMs]
  );

  return mapRowToLatencyMetric(result.rows[0]);
}

export async function getLatencyByEntityAndOperation(
  entityType: string,
  operation: string,
  hours: number = 1
): Promise<LatencyMetric[]> {
  const result = await pool.query(
    `SELECT id, entity_type, operation, latency_ms, timestamp
     FROM latency_metrics
     WHERE entity_type = $1 AND operation = $2
     AND timestamp > NOW() - INTERVAL '${hours} hours'
     ORDER BY timestamp DESC`,
    [entityType, operation]
  );

  return result.rows.map(mapRowToLatencyMetric);
}

export async function getLatencyStats(
  entityType: string,
  operation: string,
  hours: number = 1
): Promise<LatencyStats> {
  const result = await pool.query(
    `SELECT
      entity_type,
      operation,
      COUNT(*) as count,
      MIN(latency_ms) as min_latency,
      MAX(latency_ms) as max_latency,
      AVG(latency_ms) as avg_latency,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) as p50_latency,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99_latency,
      COUNT(CASE WHEN latency_ms <= $3 THEN 1 END) as within_slo
     FROM latency_metrics
     WHERE entity_type = $1 AND operation = $2
     AND timestamp > NOW() - INTERVAL '${hours} hours'
     GROUP BY entity_type, operation`,
    [entityType, operation, SLO_TARGET_MS]
  );

  if (result.rows.length === 0) {
    return {
      entityType,
      operation,
      count: 0,
      minLatency: 0,
      maxLatency: 0,
      averageLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      withinSLO: 0,
      sloViolationRate: 0,
    };
  }

  const row = result.rows[0];
  const count = parseInt(row.count, 10);
  const withinSLO = parseInt(row.within_slo, 10);

  return {
    entityType: row.entity_type,
    operation: row.operation,
    count,
    minLatency: Math.round(parseFloat(row.min_latency)),
    maxLatency: Math.round(parseFloat(row.max_latency)),
    averageLatency: Math.round(parseFloat(row.avg_latency)),
    p50Latency: Math.round(parseFloat(row.p50_latency) || 0),
    p95Latency: Math.round(parseFloat(row.p95_latency) || 0),
    p99Latency: Math.round(parseFloat(row.p99_latency) || 0),
    withinSLO,
    sloViolationRate: Math.round(((count - withinSLO) / count) * 10000) / 100, // percentage with 2 decimals
  };
}

export async function getAggregatedMetrics(hours: number = 1): Promise<AggregatedMetrics> {
  // Get all unique entity/operation combinations
  const result = await pool.query(
    `SELECT DISTINCT entity_type, operation FROM latency_metrics
     WHERE timestamp > NOW() - INTERVAL '${hours} hours'
     ORDER BY entity_type, operation`
  );

  const byEntity: LatencyStats[] = [];

  for (const row of result.rows) {
    const stats = await getLatencyStats(row.entity_type, row.operation, hours);
    byEntity.push(stats);
  }

  // Calculate global stats
  const globalResult = await pool.query(
    `SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN latency_ms <= $1 THEN 1 END) as within_slo
     FROM latency_metrics
     WHERE timestamp > NOW() - INTERVAL '${hours} hours'`,
    [SLO_TARGET_MS]
  );

  const globalTotal = parseInt(globalResult.rows[0].total, 10);
  const globalWithinSLO = parseInt(globalResult.rows[0].within_slo, 10);
  const globalSLORate = globalTotal > 0 ? Math.round((globalWithinSLO / globalTotal) * 10000) / 100 : 0;

  return {
    period: {
      startTime: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
      hours,
    },
    globalStats: {
      totalOperations: globalTotal,
      operationsWithinSLO: globalWithinSLO,
      globalSLORate,
    },
    byEntity: byEntity.sort((a, b) => a.sloViolationRate - b.sloViolationRate), // Sort by violation rate (worst first)
  };
}

export async function checkSLOViolations(hours: number = 1): Promise<string[]> {
  const alerts: string[] = [];

  const stats = await getAggregatedMetrics(hours);

  // Global SLO check
  if (stats.globalStats.globalSLORate < 95) {
    alerts.push(
      `Global SLO Violation: Only ${stats.globalStats.globalSLORate}% of operations completed within 30s (target: 95%)`
    );
  }

  // Per-entity SLO check
  for (const entity of stats.byEntity) {
    if (entity.p95Latency > SLO_TARGET_MS) {
      alerts.push(
        `${entity.entityType} ${entity.operation}: p95 latency ${entity.p95Latency}ms exceeds 30s target`
      );
    }
  }

  return alerts;
}

export async function cleanupOldMetrics(daysToKeep: number = 7): Promise<number> {
  const result = await pool.query(
    `DELETE FROM latency_metrics WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'`
  );

  return result.rowCount || 0;
}

// Helper function
function mapRowToLatencyMetric(row: any): LatencyMetric {
  return {
    id: row.id,
    entityType: row.entity_type,
    operation: row.operation,
    latencyMs: row.latency_ms,
    timestamp: row.timestamp,
  };
}
