import pool from '../database/connection';
import { AppError } from '../utils/errors';

export interface DataFreshness {
  lastRefresh: string; // ISO 8601 timestamp
  dataAge: number; // milliseconds
  freshness: 'fresh' | 'stale' | 'very_stale';
  cachedAt: string;
}

export interface PipelineMetrics {
  userId?: string;
  eventType: 'update' | 'refresh' | 'cache_hit' | 'cache_miss';
  latencyMs: number;
  dataAgeMs: number;
  timestamp: Date;
}

// Cache freshness thresholds (in milliseconds)
const FRESH_THRESHOLD = 10000; // 10 seconds = fresh
const STALE_THRESHOLD = 20000; // 20 seconds = stale
// > 20 seconds = very_stale

class DataPipeline {
  private lastRefreshTimestamps: Map<string, number> = new Map();
  private metricsBuffer: PipelineMetrics[] = [];

  // Initialize pipeline for a user
  async initializeUserPipeline(userId: string): Promise<void> {
    this.lastRefreshTimestamps.set(userId, Date.now());
  }

  // Invalidate cache (trigger refresh)
  invalidateUserData(userId: string): void {
    // In a real implementation, this would clear Redis cache
    // For now, we just record the invalidation
    this.lastRefreshTimestamps.set(userId, Date.now());
  }

  // Log pipeline metric
  recordMetric(metric: PipelineMetrics): void {
    this.metricsBuffer.push(metric);

    // Save to database asynchronously (non-blocking)
    this.saveMetricAsync(metric).catch((err) => {
      console.error('Failed to save pipeline metric:', err);
    });
  }

  // Get data freshness status
  async getDataFreshness(userId: string): Promise<DataFreshness> {
    const lastRefresh = this.lastRefreshTimestamps.get(userId) || Date.now();
    const now = Date.now();
    const dataAge = now - lastRefresh;

    let freshness: 'fresh' | 'stale' | 'very_stale';
    if (dataAge < FRESH_THRESHOLD) {
      freshness = 'fresh';
    } else if (dataAge < STALE_THRESHOLD) {
      freshness = 'stale';
    } else {
      freshness = 'very_stale';
    }

    return {
      lastRefresh: new Date(lastRefresh).toISOString(),
      dataAge,
      freshness,
      cachedAt: new Date().toISOString(),
    };
  }

  // Get aggregated metrics
  async getPipelineMetrics(
    userId?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<{
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    cacheHitRate: number;
    freshRate: number;
  }> {
    try {
      let query = 'SELECT latency_ms, data_age_ms, event_type FROM pipeline_metrics WHERE 1=1';
      const params: any[] = [];

      if (userId) {
        query += ` AND user_id = $${params.length + 1}`;
        params.push(userId);
      }

      if (startTime) {
        query += ` AND timestamp >= $${params.length + 1}`;
        params.push(startTime);
      }

      if (endTime) {
        query += ` AND timestamp <= $${params.length + 1}`;
        params.push(endTime);
      }

      const result = await pool.query(query);
      const metrics = result.rows;

      if (metrics.length === 0) {
        return {
          averageLatency: 0,
          p95Latency: 0,
          p99Latency: 0,
          cacheHitRate: 0,
          freshRate: 0,
        };
      }

      // Calculate latency stats
      const latencies = metrics.map((m) => m.latency_ms).sort((a, b) => a - b);
      const averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
      const p99Latency = latencies[Math.floor(latencies.length * 0.99)];

      // Calculate cache hit rate
      const cacheHits = metrics.filter((m) => m.event_type === 'cache_hit').length;
      const cacheHitRate = (cacheHits / metrics.length) * 100;

      // Calculate freshness rate (% of events with dataAge < 30s)
      const freshEvents = metrics.filter((m) => m.data_age_ms < 30000).length;
      const freshRate = (freshEvents / metrics.length) * 100;

      return {
        averageLatency,
        p95Latency,
        p99Latency,
        cacheHitRate,
        freshRate,
      };
    } catch (error) {
      console.error('Error getting pipeline metrics:', error);
      throw error;
    }
  }

  // Save metric to database
  private async saveMetricAsync(metric: PipelineMetrics): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO pipeline_metrics (user_id, event_type, latency_ms, data_age_ms, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [metric.userId || null, metric.eventType, metric.latencyMs, metric.dataAgeMs, metric.timestamp]
      );
    } catch (error) {
      // Log but don't throw (non-blocking)
      console.error('Failed to save metric to database:', error);
    }
  }
}

// Singleton instance
export const dataPipeline = new DataPipeline();
