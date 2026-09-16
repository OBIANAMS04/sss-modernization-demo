/**
 * Stress Test: High-Load Scenarios
 * Tests application behavior under heavy load
 */

import request from 'supertest';
import { performance } from 'perf_hooks';

describe('Stress Tests', () => {
  let app: any;
  let token: string;

  beforeAll(async () => {
    app = require('../../src/server');
    token = 'test-jwt-token'; // Use valid token from setup
  });

  describe('Concurrent User Load', () => {
    it('should handle 100 concurrent requests', async () => {
      const requests = Array(100)
        .fill(null)
        .map(() =>
          request(app)
            .get('/api/health')
            .set('Authorization', `Bearer ${token}`)
            .catch((e) => ({ error: e.message }))
        );

      const start = performance.now();
      const results = await Promise.allSettled(requests);
      const duration = performance.now() - start;

      // Count successes
      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status < 400
      ).length;

      expect(successes).toBeGreaterThan(95); // Allow 5% failure
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds

      // Calculate stats
      const avgLatency = duration / 100;
      console.log(`Stress Test Stats:
        - Concurrent requests: 100
        - Success rate: ${(successes / 100) * 100}%
        - Total duration: ${duration.toFixed(0)}ms
        - Average latency: ${avgLatency.toFixed(0)}ms
      `);
    });

    it('should handle 500 concurrent requests', async () => {
      const requests = Array(500)
        .fill(null)
        .map(() =>
          request(app)
            .get('/api/cases')
            .set('Authorization', `Bearer ${token}`)
            .catch((e) => ({ error: e.message }))
        );

      const start = performance.now();
      const results = await Promise.allSettled(requests);
      const duration = performance.now() - start;

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status < 400
      ).length;

      expect(successes).toBeGreaterThan(450); // Allow 10% failure
      console.log(`500 Concurrent: ${successes}/500 succeeded in ${duration.toFixed(0)}ms`);
    });

    it('should recover after burst load', async () => {
      // Send burst of 200 requests
      const burst = Array(200)
        .fill(null)
        .map(() =>
          request(app)
            .get('/api/cases')
            .set('Authorization', `Bearer ${token}`)
        );

      await Promise.allSettled(burst);

      // Wait 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Send normal load
      const normal = await Promise.allSettled(
        Array(10)
          .fill(null)
          .map(() =>
            request(app)
              .get('/api/cases')
              .set('Authorization', `Bearer ${token}`)
          )
      );

      const successes = normal.filter((r) => r.status === 'fulfilled').length;
      expect(successes).toBe(10); // Should fully recover
    });
  });

  describe('Database Load', () => {
    it('should handle rapid writes', async () => {
      const writes = Array(50)
        .fill(null)
        .map((_, i) =>
          request(app)
            .post('/api/cases')
            .set('Authorization', `Bearer ${token}`)
            .send({
              status: 'Draft',
              type: 'Exemption Request',
              reason: `Stress test case ${i}`,
            })
        );

      const start = performance.now();
      const results = await Promise.allSettled(writes);
      const duration = performance.now() - start;

      const successes = results.filter((r) => r.status === 'fulfilled').length;
      expect(successes).toBeGreaterThan(45);
      console.log(`50 Concurrent Writes: ${successes}/50 succeeded in ${duration.toFixed(0)}ms`);
    });

    it('should handle rapid reads', async () => {
      const reads = Array(100)
        .fill(null)
        .map(() =>
          request(app)
            .get('/api/cases')
            .set('Authorization', `Bearer ${token}`)
        );

      const start = performance.now();
      const results = await Promise.allSettled(reads);
      const duration = performance.now() - start;

      const successes = results.filter((r) => r.status === 'fulfilled').length;
      expect(successes).toBeGreaterThan(95);
      console.log(`100 Concurrent Reads: ${successes}/100 succeeded in ${duration.toFixed(0)}ms`);
    });

    it('should handle mixed read/write operations', async () => {
      const operations = Array(100)
        .fill(null)
        .map((_, i) => {
          if (i % 2 === 0) {
            // Even: read
            return request(app)
              .get('/api/cases')
              .set('Authorization', `Bearer ${token}`);
          } else {
            // Odd: write
            return request(app)
              .post('/api/cases')
              .set('Authorization', `Bearer ${token}`)
              .send({
                status: 'Draft',
                type: 'Exemption Request',
                reason: `Mixed operation ${i}`,
              });
          }
        });

      const start = performance.now();
      const results = await Promise.allSettled(operations);
      const duration = performance.now() - start;

      const successes = results.filter((r) => r.status === 'fulfilled').length;
      expect(successes).toBeGreaterThan(90);
      console.log(
        `100 Mixed Operations (50R/50W): ${successes}/100 succeeded in ${duration.toFixed(0)}ms`
      );
    });
  });

  describe('Memory & Resource Management', () => {
    it('should not leak memory during load', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Send 1000 requests in batches
      for (let batch = 0; batch < 5; batch++) {
        const requests = Array(200)
          .fill(null)
          .map(() =>
            request(app)
              .get('/api/cases')
              .set('Authorization', `Bearer ${token}`)
          );

        await Promise.allSettled(requests);
        console.log(`Batch ${batch + 1}/5 complete`);
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`Memory growth: ${memoryGrowth.toFixed(2)}MB`);
      expect(memoryGrowth).toBeLessThan(100); // Should not grow > 100MB
    });

    it('should handle large response payloads', async () => {
      const res = await request(app)
        .get('/api/audit?limit=10000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      console.log(`Large payload: ${JSON.stringify(res.body).length} bytes`);
    });
  });

  describe('Error Handling Under Load', () => {
    it('should handle errors gracefully', async () => {
      const requests = Array(50)
        .fill(null)
        .map((_, i) => {
          // Half with valid requests, half with invalid
          if (i % 2 === 0) {
            return request(app)
              .get('/api/cases')
              .set('Authorization', `Bearer ${token}`);
          } else {
            return request(app)
              .get('/api/cases/invalid-id')
              .set('Authorization', `Bearer ${token}`);
          }
        });

      const results = await Promise.allSettled(requests);
      expect(results).toHaveLength(50);

      // Count responses by status
      const statusCounts = results.reduce((acc: any, r) => {
        if (r.status === 'fulfilled') {
          const status = r.value.status;
          acc[status] = (acc[status] || 0) + 1;
        }
        return acc;
      }, {});

      console.log(`Error handling stats:`, statusCounts);
      expect(statusCounts[200]).toBeGreaterThan(0); // Some successes
      expect(statusCounts[404]).toBeGreaterThan(0); // Some 404s
    });

    it('should timeout long-running requests', async () => {
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve('timeout'), 5000);
      });

      const request1 = request(app)
        .get('/api/cases')
        .set('Authorization', `Bearer ${token}`);

      const result = await Promise.race([request1, timeoutPromise]);

      // Should complete before timeout
      expect(result).not.toBe('timeout');
    });
  });

  describe('Latency Distribution', () => {
    it('should measure latency percentiles', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        await request(app)
          .get('/api/cases')
          .set('Authorization', `Bearer ${token}`);
        const latency = performance.now() - start;
        latencies.push(latency);
      }

      latencies.sort((a, b) => a - b);

      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      console.log(`Latency Distribution (100 requests):
        - p50: ${p50.toFixed(0)}ms
        - p95: ${p95.toFixed(0)}ms (SLO: <500ms)
        - p99: ${p99.toFixed(0)}ms (SLO: <1000ms)
      `);

      expect(p95).toBeLessThan(500);
      expect(p99).toBeLessThan(1000);
    });
  });

  describe('Throughput Measurement', () => {
    it('should measure requests per second', async () => {
      const duration = 10000; // 10 seconds
      let requestCount = 0;
      const endTime = Date.now() + duration;

      while (Date.now() < endTime) {
        await request(app)
          .get('/api/health')
          .set('Authorization', `Bearer ${token}`);
        requestCount++;
      }

      const rps = (requestCount / (duration / 1000)).toFixed(0);
      console.log(`Throughput: ${rps} requests/second`);
      expect(parseInt(rps)).toBeGreaterThan(50); // Should handle at least 50 RPS
    });
  });
});
