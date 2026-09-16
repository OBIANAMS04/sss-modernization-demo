/**
 * Load Testing Script for SSS Modernization Platform
 * Uses k6 for distributed load testing
 *
 * Usage: k6 run load-test.js
 * With options: k6 run --vus 100 --duration 5m load-test.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 50 },   // Ramp up to 50 users
    { duration: '10m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 50 },   // Ramp down to 50 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
    'group_duration{group:::auth}': ['p(95)<300'],
    'group_duration{group:::cases}': ['p(95)<400'],
  },
};

// Custom metrics
const authDuration = new Trend('auth_duration');
const casesDuration = new Trend('cases_duration');
const errorRate = new Rate('error_rate');
const requestCount = new Counter('request_count');

const BASE_URL = __ENV.BASE_URL || 'https://sss-modernization.example.com';
const API_URL = `${BASE_URL}/api`;

// Test data
const testUsers = [
  { email: 'citizen1@example.com', password: 'TestPassword123!', role: 'citizen' },
  { email: 'manager1@example.com', password: 'TestPassword123!', role: 'case_manager' },
];

let authToken = '';

/**
 * Setup: Authenticate before load tests
 */
export function setup() {
  const payload = JSON.stringify({
    email: testUsers[0].email,
    password: testUsers[0].password,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post(`${API_URL}/auth/login`, payload, params);
  const data = res.json();

  if (res.status === 200) {
    return { token: data.token };
  } else {
    throw new Error('Failed to authenticate');
  }
}

/**
 * Authentication Load Test
 */
export function authLoadTest(data) {
  group('Authentication', () => {
    const payload = JSON.stringify({
      email: testUsers[0].email,
      password: testUsers[0].password,
    });

    const params = {
      headers: { 'Content-Type': 'application/json' },
    };

    const startTime = new Date();
    const res = http.post(`${API_URL}/auth/login`, payload, params);
    const duration = new Date() - startTime;

    authDuration.add(duration);
    requestCount.add(1);

    check(res, {
      'login status is 200': (r) => r.status === 200,
      'auth response has token': (r) => r.json('token') !== undefined,
    }) || errorRate.add(1);

    if (res.status === 200) {
      authToken = res.json('token');
    }
  });

  sleep(1);
}

/**
 * Cases CRUD Load Test
 */
export function casesLoadTest(data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  };

  group('Cases - Read', () => {
    const startTime = new Date();
    const res = http.get(`${API_URL}/cases`, { headers });
    const duration = new Date() - startTime;

    casesDuration.add(duration);
    requestCount.add(1);

    check(res, {
      'list cases status is 200': (r) => r.status === 200,
      'cases response is array': (r) => Array.isArray(r.json()),
      'response time < 500ms': (r) => duration < 500,
    }) || errorRate.add(1);
  });

  sleep(0.5);

  group('Cases - Create', () => {
    const caseData = JSON.stringify({
      citizen_id: 'citizen-' + Math.random().toString(36).substr(2, 9),
      status: 'Draft',
      type: 'Exemption Request',
      reason: 'Load test case',
    });

    const startTime = new Date();
    const res = http.post(`${API_URL}/cases`, caseData, { headers });
    const duration = new Date() - startTime;

    casesDuration.add(duration);
    requestCount.add(1);

    check(res, {
      'create case status is 201': (r) => r.status === 201,
      'case has id': (r) => r.json('id') !== undefined,
      'response time < 500ms': (r) => duration < 500,
    }) || errorRate.add(1);

    return res.json('id');
  });

  sleep(0.5);
}

/**
 * Exemption Check Load Test
 */
export function exemptionLoadTest(data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  };

  group('Exemptions - Check Eligibility', () => {
    const exemptionData = JSON.stringify({
      age: Math.floor(Math.random() * 80) + 18,
      income: Math.floor(Math.random() * 100000),
      has_hardship: Math.random() > 0.5,
    });

    const startTime = new Date();
    const res = http.post(`${API_URL}/exemptions/check`, exemptionData, { headers });
    const duration = new Date() - startTime;

    requestCount.add(1);

    check(res, {
      'exemption check status is 200': (r) => r.status === 200,
      'has eligible field': (r) => 'eligible' in r.json(),
      'response time < 300ms': (r) => duration < 300,
    }) || errorRate.add(1);
  });

  sleep(1);
}

/**
 * Compliance Check Load Test
 */
export function complianceLoadTest(data) {
  const headers = {
    'Authorization': `Bearer ${data.token}`,
  };

  group('Compliance - Matrix', () => {
    const startTime = new Date();
    const res = http.get(`${API_URL}/compliance/matrix`, { headers });
    const duration = new Date() - startTime;

    requestCount.add(1);

    check(res, {
      'compliance matrix status is 200': (r) => r.status === 200,
      'has requirements': (r) => Array.isArray(r.json('requirements')),
      'response time < 500ms': (r) => duration < 500,
    }) || errorRate.add(1);
  });

  sleep(1);
}

/**
 * Metrics Query Load Test
 */
export function metricsLoadTest(data) {
  const headers = {
    'Authorization': `Bearer ${data.token}`,
  };

  group('Metrics - Latency Stats', () => {
    const startTime = new Date();
    const res = http.get(`${API_URL}/latency/stats`, { headers });
    const duration = new Date() - startTime;

    requestCount.add(1);

    check(res, {
      'metrics status is 200': (r) => r.status === 200,
      'has p50, p95, p99': (r) => {
        const json = r.json();
        return json.p50 && json.p95 && json.p99;
      },
      'response time < 500ms': (r) => duration < 500,
    }) || errorRate.add(1);
  });

  sleep(1);
}

/**
 * Main Default Function
 */
export default function (data) {
  authLoadTest(data);
  casesLoadTest(data);
  exemptionLoadTest(data);
  complianceLoadTest(data);
  metricsLoadTest(data);
}

/**
 * Teardown: Report results
 */
export function teardown(data) {
  console.log('Load test completed!');
}

/**
 * Custom summary for results
 */
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
  };
}

/**
 * Text summary helper
 */
function textSummary(data, options) {
  let summary = '\n=== Load Test Summary ===\n';
  summary += `Total Requests: ${data.metrics.request_count?.value || 0}\n`;
  summary += `Error Rate: ${((data.metrics.error_rate?.value || 0) * 100).toFixed(2)}%\n`;

  if (data.metrics.http_req_duration) {
    const dur = data.metrics.http_req_duration.values;
    summary += `Response Time (p95): ${dur['p(95)']}ms\n`;
    summary += `Response Time (p99): ${dur['p(99)']}ms\n`;
  }

  return summary;
}
