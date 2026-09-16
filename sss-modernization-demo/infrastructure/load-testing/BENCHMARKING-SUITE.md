# Performance Benchmarking Suite

**Version:** 1.0  
**Date:** August 6, 2026  
**Purpose:** Automated performance testing, profiling, and benchmarking  

---

## Table of Contents
1. Benchmarking Framework Setup (k6)
2. Load Test Scenarios
3. Performance Baselines
4. Continuous Benchmarking
5. Reporting & Analysis
6. Optimization Recommendations

---

## 1. Benchmarking Framework Setup

### k6 Installation & Configuration

```bash
# Install k6
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Windows (via Chocolatey)
choco install k6

# Verify installation
k6 version  # Output: k6 vX.XX.X

# Install extensions
npm install -D @k6/http @k6/encoding xk6-prometheus
```

### Base Configuration

```javascript
// infrastructure/load-testing/config.js

export const baseConfig = {
  baseURL: __ENV.BASE_URL || 'http://localhost:5000',
  apiUrl: __ENV.API_URL || 'http://localhost:5000/api',
  graphqlUrl: __ENV.GRAPHQL_URL || 'http://localhost:5000/graphql',
  
  // Test credentials
  testEmail: __ENV.TEST_EMAIL || 'test@example.com',
  testPassword: __ENV.TEST_PASSWORD || 'Password123!',
  
  // Timeouts
  connectionTimeout: 10000,
  requestTimeout: 30000,
  
  // Thresholds
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.1'],
    'checks': ['rate>0.95']
  },
  
  // VU stages
  stages: [
    { duration: '1m', target: 10 },    // Ramp up
    { duration: '3m', target: 50 },    // Peak
    { duration: '2m', target: 100 },   // Stress
    { duration: '1m', target: 0 }      // Ramp down
  ]
};
```

---

## 2. Load Test Scenarios

### Scenario 1: Normal Business Load

```javascript
// infrastructure/load-testing/scenarios/normal-load.js

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '2m', target: 50 },   // 50 concurrent users
    { duration: '5m', target: 50 },   // Stay at 50
    { duration: '2m', target: 0 }     // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.1'],
    errors: ['rate<0.05']
  }
};

export default function (data) {
  const email = `test${Math.random()}@example.com`;
  const password = 'Password123!';

  // 1. Register user
  let registerRes = http.post(`${__ENV.API_URL}/auth/register`, {
    email,
    password,
    fullName: 'Test User'
  });

  check(registerRes, {
    'register: status 201': (r) => r.status === 201,
    'register: got token': (r) => r.json('token') !== null
  }) || errorRate.add(1);

  const token = registerRes.json('token');
  sleep(1);

  // 2. Create case
  let caseRes = http.post(
    `${__ENV.API_URL}/cases`,
    {
      status: 'Draft',
      type: 'Exemption Request',
      reason: 'Test case'
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  check(caseRes, {
    'create case: status 201': (r) => r.status === 201,
    'create case: got case ID': (r) => r.json('id') !== null,
    'create case latency < 500ms': (r) => r.timings.duration < 500
  }) || errorRate.add(1);

  const caseId = caseRes.json('id');
  sleep(2);

  // 3. Get cases list
  let casesRes = http.get(
    `${__ENV.API_URL}/cases?page=1&limit=20`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  check(casesRes, {
    'list cases: status 200': (r) => r.status === 200,
    'list cases: got array': (r) => r.json('data').length >= 0,
    'list cases latency < 200ms': (r) => r.timings.duration < 200
  }) || errorRate.add(1);

  sleep(1);

  // 4. Add note to case
  let noteRes = http.post(
    `${__ENV.API_URL}/cases/${caseId}/notes`,
    {
      content: 'This is a test note'
    },
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  check(noteRes, {
    'add note: status 201': (r) => r.status === 201,
    'add note latency < 300ms': (r) => r.timings.duration < 300
  }) || errorRate.add(1);

  sleep(3);
}
```

### Scenario 2: Peak Load Stress Test

```javascript
// infrastructure/load-testing/scenarios/stress-test.js

import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp to 100 users
    { duration: '5m', target: 200 },   // Ramp to 200 users
    { duration: '5m', target: 500 },   // Ramp to 500 users (peak stress)
    { duration: '3m', target: 0 }      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000'],  // More lenient under stress
    'http_req_failed': ['rate<0.2'],       // Allow 20% failures
    'checks': ['rate>0.80']
  }
};

export default function () {
  const token = __ENV.AUTH_TOKEN;

  // Simulate rapid case creation
  for (let i = 0; i < 5; i++) {
    let res = http.post(
      `${__ENV.API_URL}/cases`,
      {
        status: 'Draft',
        type: 'Exemption Request',
        reason: `Stress test case ${i}`
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: '30s'
      }
    );

    check(res, {
      'case created under stress': (r) => r.status === 201
    });

    sleep(0.5);
  }

  // Simulate rapid case listing
  http.get(`${__ENV.API_URL}/cases?limit=100`, {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    timeout: '30s'
  });

  sleep(1);
}
```

### Scenario 3: Endurance Test (24-hour simulation)

```javascript
// infrastructure/load-testing/scenarios/endurance-test.js

import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    // Simulate 24-hour business day with varying load
    
    // Early morning (6-9 AM): Light load
    { duration: '3m', target: 10, name: 'early-morning' },
    
    // Morning (9 AM-12 PM): Normal load
    { duration: '3m', target: 50, name: 'morning' },
    
    // Midday (12-1 PM): Slight dip
    { duration: '1m', target: 30, name: 'lunch' },
    
    // Afternoon (1-5 PM): High load
    { duration: '4m', target: 80, name: 'afternoon' },
    
    // Evening (5-6 PM): Peak hour
    { duration: '1m', target: 100, name: 'peak' },
    
    // Late evening (6 PM+): Wind down
    { duration: '3m', target: 20, name: 'evening' }
  ],
  
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.1'],
    'checks': ['rate>0.95']
  },
  
  // Track errors by stage
  ext: {
    loadimpact: {
      projectID: __ENV.LOAD_IMPACT_ID,
      name: 'SSS Endurance Test'
    }
  }
};

export default function () {
  // Realistic user behavior
  
  // 1. Check dashboard (quick)
  http.get(`${__ENV.API_URL}/cases`, {
    headers: { 'Authorization': `Bearer ${__ENV.AUTH_TOKEN}` }
  });
  sleep(2);

  // 2. View a case (medium time)
  http.get(`${__ENV.API_URL}/cases/case-123`, {
    headers: { 'Authorization': `Bearer ${__ENV.AUTH_TOKEN}` }
  });
  sleep(5);

  // 3. Add a note (quick action)
  http.post(`${__ENV.API_URL}/cases/case-123/notes`, 
    { content: 'Endurance test note' },
    {
      headers: { 'Authorization': `Bearer ${__ENV.AUTH_TOKEN}` }
    }
  );
  sleep(10);

  // 4. Search cases (medium time)
  http.get(`${__ENV.API_URL}/cases?status=APPROVED&limit=50`, {
    headers: { 'Authorization': `Bearer ${__ENV.AUTH_TOKEN}` }
  });
  sleep(3);
}
```

### Scenario 4: GraphQL Performance Test

```javascript
// infrastructure/load-testing/scenarios/graphql-test.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 30 },
    { duration: '5m', target: 30 },
    { duration: '2m', target: 0 }
  ],
  thresholds: {
    'graphql_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.1']
  }
};

export default function () {
  const token = __ENV.AUTH_TOKEN;

  // GraphQL query: Get user with cases
  const query = `
    query {
      me {
        id
        email
        cases(first: 20) {
          edges {
            node {
              id
              status
              createdAt
            }
          }
        }
      }
    }
  `;

  let res = http.post(
    `${__ENV.GRAPHQL_URL}`,
    JSON.stringify({ query }),
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  check(res, {
    'graphql: status 200': (r) => r.status === 200,
    'graphql: got data': (r) => r.json('data.me') !== null,
    'graphql: no errors': (r) => !r.json('errors')
  });

  sleep(2);

  // GraphQL mutation: Create case
  const mutation = `
    mutation {
      createCase(input: {
        status: DRAFT
        type: "Exemption Request"
        reason: "GraphQL test"
      }) {
        id
        status
        createdAt
      }
    }
  `;

  res = http.post(
    `${__ENV.GRAPHQL_URL}`,
    JSON.stringify({ query: mutation }),
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  check(res, {
    'graphql mutation: created': (r) => r.json('data.createCase.id') !== null
  });

  sleep(3);
}
```

---

## 3. Performance Baselines

### Expected Performance Metrics

```yaml
# infrastructure/load-testing/baselines.yaml

baselines:
  # API Response Times (p95)
  auth:
    register: 300ms
    login: 250ms
    mfa_verify: 200ms

  cases:
    create: 200ms
    list: 150ms
    update: 180ms
    get_by_id: 100ms

  exemptions:
    check: 250ms
    get: 100ms

  compliance:
    check: 400ms
    matrix: 100ms

  graphql:
    query: 300ms
    mutation: 350ms

  # Throughput (requests per second)
  throughput:
    single_user: 10 req/s
    normal_load_50: 300 req/s
    peak_load_200: 1000 req/s

  # Error Rates
  error_rates:
    normal: 0.05%
    stress: 0.5%
    peak: 2%

  # Resource Utilization
  resources:
    cpu_normal: 30-40%
    cpu_peak: 70-80%
    memory_normal: 200-250MB
    memory_peak: 400-500MB
    db_connections: 10-15 (max 20)
    cache_memory: 100-150MB
```

---

## 4. Continuous Benchmarking

### Automated Benchmark Script

```bash
#!/bin/bash
# infrastructure/load-testing/run-benchmarks.sh

set -e

# Configuration
API_URL="http://localhost:5000/api"
GRAPHQL_URL="http://localhost:5000/graphql"
AUTH_TOKEN="${AUTH_TOKEN:-}"
RESULTS_DIR="./load-testing/results"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)

# Create results directory
mkdir -p "$RESULTS_DIR"

echo "=== SSS Modernization Performance Benchmarks ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Get authentication token
if [ -z "$AUTH_TOKEN" ]; then
  echo "Getting authentication token..."
  REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "benchmark-'$TIMESTAMP'@example.com",
      "password": "Password123!",
      "fullName": "Benchmark User"
    }')
  
  AUTH_TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.token')
  echo "Token obtained: ${AUTH_TOKEN:0:20}..."
fi

# Run Scenario 1: Normal Load
echo ""
echo "Running Scenario 1: Normal Load Test..."
k6 run \
  --vus 50 \
  --duration 5m \
  -e BASE_URL=$API_URL \
  -e API_URL=$API_URL \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  --out json=results/normal-load-$TIMESTAMP.json \
  infrastructure/load-testing/scenarios/normal-load.js

# Run Scenario 2: Stress Test
echo ""
echo "Running Scenario 2: Stress Test..."
k6 run \
  -e BASE_URL=$API_URL \
  -e API_URL=$API_URL \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  --out json=results/stress-test-$TIMESTAMP.json \
  infrastructure/load-testing/scenarios/stress-test.js

# Run Scenario 3: GraphQL Test
echo ""
echo "Running Scenario 3: GraphQL Performance Test..."
k6 run \
  -e BASE_URL=$API_URL \
  -e GRAPHQL_URL=$GRAPHQL_URL \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  --out json=results/graphql-test-$TIMESTAMP.json \
  infrastructure/load-testing/scenarios/graphql-test.js

# Generate HTML report
echo ""
echo "Generating HTML report..."
k6 run \
  --out json=results/full-suite-$TIMESTAMP.json \
  infrastructure/load-testing/scenarios/normal-load.js

# Compare with baseline
echo ""
echo "Comparing with baseline..."
node infrastructure/load-testing/compare-baseline.js \
  --baseline baselines.yaml \
  --results "results/full-suite-$TIMESTAMP.json" \
  --output "results/comparison-$TIMESTAMP.html"

echo ""
echo "Benchmarking complete!"
echo "Results saved to: $RESULTS_DIR/"
echo "Report: $RESULTS_DIR/comparison-$TIMESTAMP.html"
```

### GitHub Actions CI/CD Integration

```yaml
# .github/workflows/performance-benchmarks.yml

name: Performance Benchmarks

on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday at 2 AM UTC
  workflow_dispatch:  # Manual trigger

jobs:
  benchmark:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: password
          POSTGRES_DB: sssdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Install k6
        run: sudo apt-get update && sudo apt-get install -y k6

      - name: Install Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Start backend server
        run: |
          npm run db:migrate
          npm run dev &
          sleep 5

      - name: Run benchmarks
        run: bash infrastructure/load-testing/run-benchmarks.sh

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: benchmark-results
          path: infrastructure/load-testing/results/

      - name: Compare with baseline
        run: |
          node infrastructure/load-testing/compare-baseline.js \
            --baseline infrastructure/load-testing/baselines.yaml \
            --results infrastructure/load-testing/results/*

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const comparison = fs.readFileSync(
              'infrastructure/load-testing/results/comparison.json'
            );
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Performance Benchmark Results\n\n${comparison}`
            });
```

---

## 5. Reporting & Analysis

### HTML Report Generation

```javascript
// infrastructure/load-testing/generate-report.js

const fs = require('fs');
const path = require('path');
const json = require('./results/results.json');

function generateReport(data) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Performance Benchmark Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .metric { margin: 20px 0; padding: 10px; border: 1px solid #ddd; }
    .pass { color: green; }
    .fail { color: red; }
    .warn { color: orange; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>Performance Benchmark Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>

  <h2>Summary</h2>
  <table>
    <tr>
      <th>Metric</th>
      <th>Value</th>
      <th>Baseline</th>
      <th>Status</th>
    </tr>
    ${Object.entries(data.metrics).map(([key, value]) => `
    <tr>
      <td>${key}</td>
      <td>${value.value}</td>
      <td>${value.baseline}</td>
      <td class="${value.status}">${value.status}</td>
    </tr>
    `).join('')}
  </table>

  <h2>Detailed Results</h2>
  <div class="metric">
    <h3>API Response Times</h3>
    <ul>
      ${Object.entries(data.latencies).map(([endpoint, latency]) => `
      <li>${endpoint}: ${latency.p95}ms (p95)</li>
      `).join('')}
    </ul>
  </div>

  <div class="metric">
    <h3>Error Rates</h3>
    <p>Total: ${data.errors.total}</p>
    <p>Rate: ${data.errors.rate}%</p>
  </div>

  <h2>Recommendations</h2>
  ${generateRecommendations(data)}
</body>
</html>
  `;

  return html;
}

fs.writeFileSync('results/report.html', generateReport(json));
```

---

## 6. Optimization Recommendations

Based on benchmark results, apply these optimizations:

```
┌─────────────────────────────────────────┐
│ Latency p95 > 500ms                     │
├─────────────────────────────────────────┤
│ ✅ Add database indexes (see #3)         │
│ ✅ Enable Redis caching (see #2)         │
│ ✅ Implement query optimization         │
│ ✅ Increase connection pool size        │
│ ✅ Check for slow queries in logs       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Error Rate > 0.1%                       │
├─────────────────────────────────────────┤
│ ✅ Review error logs                    │
│ ✅ Increase error handling retries      │
│ ✅ Check resource limits                │
│ ✅ Validate input handling              │
│ ✅ Scale services if needed             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Memory Usage > 500MB                    │
├─────────────────────────────────────────┤
│ ✅ Check for memory leaks               │
│ ✅ Profile with heap snapshots          │
│ ✅ Reduce cache size or TTL             │
│ ✅ Implement object pooling             │
│ ✅ Increase ECS task memory             │
└─────────────────────────────────────────┘
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-06  
**Estimated Execution Time:** 2-3 hours per full cycle
