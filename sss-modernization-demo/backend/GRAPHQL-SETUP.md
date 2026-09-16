# GraphQL API Layer - Setup & Implementation

**Version:** 1.0  
**Date:** August 6, 2026  
**Status:** Ready for Implementation  

---

## Overview

GraphQL provides a flexible alternative to REST API for querying and mutating data. Allows clients to request exactly the fields they need, reducing bandwidth and over-fetching.

**Benefits:**
- Single endpoint `/graphql`
- Type-safe schema with auto-documentation
- Request introspection (IDE autocomplete)
- Reduced bandwidth (fetch only needed fields)
- Easier pagination and filtering
- Compatible with existing REST API

**Technology:** Apollo Server 4.x + Express

---

## GraphQL Schema Definition

```graphql
# Core types
type User {
  id: ID!
  email: String!
  fullName: String!
  role: UserRole!
  mfaEnabled: Boolean!
  createdAt: DateTime!
  updatedAt: DateTime!
  cases: [Case!]!
  exemptions: [Exemption!]!
}

enum UserRole {
  CITIZEN
  CASE_MANAGER
  ADMIN
  LEADERSHIP
}

# Exemption types
type Exemption {
  id: ID!
  userId: ID!
  user: User!
  eligible: Boolean!
  exemptions: [ExemptionType!]!
  determinedAt: DateTime!
  createdAt: DateTime!
}

enum ExemptionType {
  TYPE_A_AGE_BASED
  TYPE_B_INCOME_BASED
  TYPE_C_HARDSHIP
}

# Case types
type Case {
  id: ID!
  userId: ID!
  user: User!
  status: CaseStatus!
  type: String!
  reason: String!
  notes: [CaseNote!]!
  createdAt: DateTime!
  updatedAt: DateTime!
  approvedAt: DateTime
  approvedBy: User
  latencyMetrics: [LatencyMetric!]!
  complianceChecks: [ComplianceCheck!]!
}

enum CaseStatus {
  DRAFT
  SUBMITTED
  IN_REVIEW
  APPROVED
  DENIED
  APPEALED
}

type CaseNote {
  id: ID!
  caseId: ID!
  case: Case!
  userId: ID!
  user: User!
  content: String!
  createdAt: DateTime!
}

# Audit & Compliance
type AuditLog {
  id: ID!
  action: String!
  actor: ID!
  actorUser: User!
  resource: String!
  resourceId: ID
  status: AuditStatus!
  details: JSON
  ipAddress: String
  userAgent: String
  timestamp: DateTime!
}

enum AuditStatus {
  SUCCESS
  DENIED
  FAILED
}

type ComplianceCheck {
  id: ID!
  caseId: ID!
  case: Case!
  userId: ID!
  user: User!
  requirement: String!
  status: ComplianceStatus!
  timestamp: DateTime!
}

enum ComplianceStatus {
  PASS
  FAIL
  PENDING
}

type LatencyMetric {
  id: ID!
  entityType: String!
  operation: String!
  latencyMs: Int!
  timestamp: DateTime!
}

# Pagination
type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
  totalCount: Int!
}

type CaseConnection {
  edges: [CaseEdge!]!
  pageInfo: PageInfo!
}

type CaseEdge {
  cursor: String!
  node: Case!
}

# Root Query type
type Query {
  # User queries
  me: User
  user(id: ID!): User
  users(
    filter: UserFilter
    first: Int
    after: String
  ): UserConnection!

  # Case queries
  case(id: ID!): Case
  cases(
    filter: CaseFilter
    sort: CaseSort
    first: Int
    after: String
  ): CaseConnection!

  # Exemption queries
  exemption(id: ID!): Exemption
  exemptions(
    userId: ID
    eligible: Boolean
    first: Int
    after: String
  ): [Exemption!]!

  # Audit queries (admin only)
  auditLogs(
    filter: AuditLogFilter
    first: Int
    after: String
  ): [AuditLog!]!

  # Compliance queries
  complianceMatrix: [ComplianceRequirement!]!
  caseCompliance(caseId: ID!): ComplianceReport!

  # Analytics queries (leadership only)
  caseStats(from: DateTime!, to: DateTime!): CaseStatistics!
  exemptionStats(from: DateTime!, to: DateTime!): ExemptionStatistics!
  complianceScore(from: DateTime!, to: DateTime!): Float!
}

# Root Mutation type
type Mutation {
  # Authentication
  register(input: RegisterInput!): AuthPayload!
  login(input: LoginInput!): AuthPayload!
  logout: Boolean!
  verifyMFA(token: String!): AuthPayload!

  # Case management
  createCase(input: CreateCaseInput!): Case!
  updateCase(id: ID!, input: UpdateCaseInput!): Case!
  deleteCase(id: ID!): Boolean!
  addCaseNote(caseId: ID!, content: String!): CaseNote!

  # Exemption management
  checkExemption(input: ExemptionCheckInput!): Exemption!
  updateExemption(id: ID!, input: UpdateExemptionInput!): Exemption!

  # Admin mutations
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!

  # Compliance
  runComplianceCheck(caseId: ID!): ComplianceReport!
}

# Input types
input RegisterInput {
  email: String!
  password: String!
  fullName: String!
}

input LoginInput {
  email: String!
  password: String!
}

input CreateCaseInput {
  status: CaseStatus!
  type: String!
  reason: String!
}

input UpdateCaseInput {
  status: CaseStatus
  reason: String
}

input ExemptionCheckInput {
  age: Int!
  income: Float!
  hasHardship: Boolean!
}

input CaseFilter {
  status: CaseStatus
  userId: ID
  createdAfter: DateTime
  createdBefore: DateTime
}

enum CaseSort {
  CREATED_ASC
  CREATED_DESC
  UPDATED_ASC
  UPDATED_DESC
}

# Response types
type AuthPayload {
  token: String!
  expiresIn: Int!
  mfaRequired: Boolean
  user: User
}

type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
}

type UserEdge {
  cursor: String!
  node: User!
}

# Analytics
type CaseStatistics {
  totalCases: Int!
  casesByStatus: [StatusCount!]!
  averageTimeToApproval: Int!
  approvalRate: Float!
  casesByType: [TypeCount!]!
  trendsOverTime: [DailyMetric!]!
}

type ExemptionStatistics {
  totalChecked: Int!
  totalApproved: Int!
  approvalRate: Float!
  byType: [ExemptionTypeCount!]!
  averageCheckTime: Int!
}

type ComplianceReport {
  caseId: ID!
  requirement: String!
  status: ComplianceStatus!
  details: String
  timestamp: DateTime!
}

type ComplianceRequirement {
  id: ID!
  name: String!
  description: String!
  status: String!
}

type StatusCount {
  status: CaseStatus!
  count: Int!
}

type TypeCount {
  type: String!
  count: Int!
}

type ExemptionTypeCount {
  type: ExemptionType!
  count: Int!
}

type DailyMetric {
  date: DateTime!
  count: Int!
}

scalar DateTime
scalar JSON
```

---

## Resolver Implementation

```javascript
// backend/src/graphql/resolvers.ts

import { AuthenticationError, ValidationError } from 'apollo-server-express';
import { Case, User, Exemption, AuditLog } from '../models';

export const resolvers = {
  Query: {
    // Get current user
    me: async (_, __, context) => {
      if (!context.user) {
        throw new AuthenticationError('Not authenticated');
      }
      return User.findById(context.user.id);
    },

    // Get single user
    user: async (_, { id }, context) => {
      authorizeAdmin(context);
      return User.findById(id);
    },

    // List users with pagination
    users: async (_, { filter, first = 20, after }, context) => {
      authorizeAdmin(context);

      let query = User.query();
      
      if (filter?.role) {
        query = query.where('role', filter.role);
      }

      const cursor = parseCursor(after);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const users = await query.limit(first + 1);
      const hasNextPage = users.length > first;
      const edges = users.slice(0, first).map(user => ({
        node: user,
        cursor: encodeCursor(user.id)
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges[edges.length - 1]?.cursor,
          totalCount: await User.query().count()
        }
      };
    },

    // Get case by ID
    case: async (_, { id }, context) => {
      authorizeCaseAccess(context, id);
      return Case.findById(id).include(['notes', 'complianceChecks']);
    },

    // List cases with filters and pagination
    cases: async (_, { filter, sort, first = 20, after }, context) => {
      let query = Case.query();

      // RBAC: Citizens see only their own cases
      if (context.user.role === 'CITIZEN') {
        query = query.where('userId', context.user.id);
      }

      // Apply filters
      if (filter?.status) {
        query = query.where('status', filter.status);
      }
      if (filter?.userId) {
        authorizeCaseAccess(context, { userId: filter.userId });
        query = query.where('userId', filter.userId);
      }
      if (filter?.createdAfter) {
        query = query.where('createdAt', '>=', filter.createdAfter);
      }
      if (filter?.createdBefore) {
        query = query.where('createdAt', '<=', filter.createdBefore);
      }

      // Apply sorting
      if (sort === 'CREATED_DESC') {
        query = query.orderBy('createdAt', 'desc');
      } else if (sort === 'UPDATED_DESC') {
        query = query.orderBy('updatedAt', 'desc');
      } else {
        query = query.orderBy('createdAt', 'asc');
      }

      // Pagination
      const cursor = parseCursor(after);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const cases = await query.limit(first + 1);
      const hasNextPage = cases.length > first;
      const edges = cases.slice(0, first).map(caseItem => ({
        node: caseItem,
        cursor: encodeCursor(caseItem.id)
      }));

      return {
        edges,
        pageInfo: {
          hasNextPage,
          endCursor: edges[edges.length - 1]?.cursor,
          totalCount: await Case.query().count()
        }
      };
    },

    // Check exemption eligibility
    exemption: async (_, { id }, context) => {
      const exemption = await Exemption.findById(id);
      if (exemption.userId !== context.user.id && context.user.role !== 'ADMIN') {
        throw new AuthenticationError('Unauthorized');
      }
      return exemption;
    },

    // Get audit logs (admin only)
    auditLogs: async (_, { filter, first = 50, after }, context) => {
      authorizeAdmin(context);

      let query = AuditLog.query();

      if (filter?.action) {
        query = query.where('action', filter.action);
      }
      if (filter?.from) {
        query = query.where('timestamp', '>=', filter.from);
      }
      if (filter?.to) {
        query = query.where('timestamp', '<=', filter.to);
      }

      const cursor = parseCursor(after);
      if (cursor) {
        query = query.where('id', '>', cursor);
      }

      const logs = await query.orderBy('timestamp', 'desc').limit(first);
      return logs;
    },

    // Get compliance matrix
    complianceMatrix: async (_, __, context) => {
      return [
        {
          id: 'FAR-AC-2',
          name: 'Account Management',
          description: 'Manage user accounts and access',
          status: 'COMPLIANT'
        },
        // ... more compliance requirements
      ];
    },

    // Analytics: Case statistics
    caseStats: async (_, { from, to }, context) => {
      authorizeLeadership(context);

      const cases = await Case.query()
        .where('createdAt', '>=', from)
        .where('createdAt', '<=', to);

      const byStatus = groupBy(cases, 'status');
      const approved = cases.filter(c => c.status === 'APPROVED').length;

      return {
        totalCases: cases.length,
        casesByStatus: Object.entries(byStatus).map(([status, items]) => ({
          status,
          count: items.length
        })),
        approvalRate: (approved / cases.length) * 100,
        averageTimeToApproval: calculateAvgApprovalTime(cases),
        trendsOverTime: calculateDailyTrends(cases, from, to)
      };
    }
  },

  Mutation: {
    // Register new user
    register: async (_, { input }, context) => {
      const { email, password, fullName } = input;

      // Validate input
      if (!isValidEmail(email)) {
        throw new ValidationError('Invalid email');
      }
      if (password.length < 12) {
        throw new ValidationError('Password must be 12+ characters');
      }

      // Check for duplicate
      const existing = await User.query().where('email', email).first();
      if (existing) {
        throw new ValidationError('Email already registered');
      }

      // Create user
      const user = await User.create({
        email,
        password: hashPassword(password),
        fullName,
        role: 'CITIZEN',
        mfaEnabled: false
      });

      // Generate token
      const token = generateJWT(user);

      // Audit log
      await logAudit('USER_REGISTERED', context.user?.id, 'users', user.id);

      return { token, expiresIn: 3600, user };
    },

    // Create case
    createCase: async (_, { input }, context) => {
      if (!context.user) {
        throw new AuthenticationError('Not authenticated');
      }

      const newCase = await Case.create({
        userId: context.user.id,
        status: input.status,
        type: input.type,
        reason: input.reason
      });

      // Log action
      await logAudit('CASE_CREATED', context.user.id, 'cases', newCase.id);

      return newCase;
    },

    // Update case
    updateCase: async (_, { id, input }, context) => {
      const caseItem = await Case.findById(id);
      
      // Authorization
      if (context.user.id !== caseItem.userId && context.user.role !== 'CASE_MANAGER') {
        throw new AuthenticationError('Unauthorized');
      }

      const updated = await caseItem.update(input);

      // Log action (redact sensitive fields)
      await logAudit('CASE_UPDATED', context.user.id, 'cases', id, {
        changes: input
      });

      return updated;
    },

    // Add case note
    addCaseNote: async (_, { caseId, content }, context) => {
      const caseItem = await Case.findById(caseId);
      
      // Authorization
      if (context.user.id !== caseItem.userId && context.user.role !== 'CASE_MANAGER') {
        throw new AuthenticationError('Unauthorized');
      }

      const note = await CaseNote.create({
        caseId,
        userId: context.user.id,
        content
      });

      await logAudit('NOTE_ADDED', context.user.id, 'cases', caseId);

      return note;
    }
  },

  // Type resolvers
  Case: {
    user: (parent) => User.findById(parent.userId),
    notes: (parent) => CaseNote.query().where('caseId', parent.id),
    complianceChecks: (parent) => ComplianceCheck.query().where('caseId', parent.id)
  },

  User: {
    cases: (parent) => Case.query().where('userId', parent.id),
    exemptions: (parent) => Exemption.query().where('userId', parent.id)
  },

  Exemption: {
    user: (parent) => User.findById(parent.userId)
  }
};
```

---

## Server Setup

```javascript
// backend/src/graphql/server.ts

import { ApolloServer } from 'apollo-server-express';
import { typeDefs } from './schema';
import { resolvers } from './resolvers';
import express from 'express';

async function startServer() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(authenticateToken); // JWT validation

  // Apollo Server
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => ({
      user: req.user, // JWT payload from middleware
      req
    }),
    formatError: (error) => {
      // Log errors
      console.error('GraphQL Error:', error);

      // Don't expose internal errors
      if (error.extensions?.code === 'INTERNAL_SERVER_ERROR') {
        return {
          message: 'Internal server error',
          extensions: {
            code: 'INTERNAL_SERVER_ERROR'
          }
        };
      }

      return error;
    },
    // Enable introspection and Apollo Sandbox in development
    introspection: process.env.NODE_ENV !== 'production',
    plugins: {
      didResolveOperation: async ({ operation, request }) => {
        // Log query complexity for monitoring
        const depth = calculateQueryDepth(operation.document);
        if (depth > 5) {
          console.warn('Deep query detected:', depth);
        }

        // Emit metric
        metrics.histogram('graphql.query.depth', depth);
      },
      willSendResponse: async ({ response, request }) => {
        // Measure response time
        const duration = Date.now() - request.startTime;
        metrics.histogram('graphql.response.duration_ms', duration);
      }
    }
  });

  await server.start();

  // Mount on /graphql
  server.applyMiddleware({ app, path: '/graphql' });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', graphql: '/graphql' });
  });

  // Start server
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/graphql`);
  });
}

startServer().catch(console.error);
```

---

## Query Examples

```graphql
# Example 1: Get current user and their cases
query {
  me {
    id
    email
    fullName
    cases(first: 10) {
      edges {
        node {
          id
          status
          createdAt
          notes {
            content
            createdAt
          }
        }
      }
    }
  }
}

# Example 2: List approved cases with compliance
query {
  cases(filter: { status: APPROVED }, first: 20) {
    edges {
      node {
        id
        status
        createdAt
        complianceChecks {
          requirement
          status
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
      totalCount
    }
  }
}

# Example 3: Case statistics (leadership)
query {
  caseStats(from: "2026-08-01", to: "2026-08-31") {
    totalCases
    approvalRate
    casesByStatus {
      status
      count
    }
    averageTimeToApproval
  }
}

# Example 4: Create case mutation
mutation {
  createCase(input: {
    status: DRAFT
    type: "Exemption Request"
    reason: "Hardship"
  }) {
    id
    status
    createdAt
  }
}

# Example 5: Update case mutation
mutation {
  updateCase(id: "case-123", input: {
    status: SUBMITTED
  }) {
    id
    status
    updatedAt
  }
}
```

---

## Performance Optimization

### Query Depth Limits
```javascript
// Prevent overly complex queries
const maxQueryDepth = 5;

function calculateQueryDepth(document) {
  let depth = 0;
  const getDepth = (node) => {
    if (node.selectionSet) {
      node.selectionSet.selections.forEach(selection => {
        depth = Math.max(depth, calculateDepth(selection) + 1);
      });
    }
  };
  document.definitions.forEach(def => getDepth(def));
  return depth;
}
```

### Batch Loading (Prevent N+1)
```javascript
import DataLoader from 'dataloader';

const userLoader = new DataLoader(async (userIds) => {
  const users = await User.query().whereIn('id', userIds);
  return userIds.map(id => users.find(u => u.id === id));
});

// In resolvers
Case: {
  user: (parent, _, context) => userLoader.load(parent.userId)
}
```

### Caching
```javascript
// Cache frequent queries
const cacheDirective = new CacheDirective();

# In schema
directive @cache(maxAge: Int) on FIELD_DEFINITION

type Query {
  user(id: ID!): User @cache(maxAge: 300)
}
```

---

## Migration Path

1. **Phase 1:** Add GraphQL alongside REST API (both active)
2. **Phase 2:** Migrate web frontend to GraphQL
3. **Phase 3:** Deprecate REST endpoints (with warnings)
4. **Phase 4:** Decommission REST API (if no longer needed)

---

## Testing GraphQL

```javascript
// backend/tests/graphql/queries.test.ts

import { gql } from 'apollo-server-express';
import { createTestClient } from 'apollo-server-testing';
import { server } from '../../graphql/server';

const { query, mutate } = createTestClient(server);

describe('GraphQL Queries', () => {
  it('should fetch current user', async () => {
    const result = await query({
      query: gql`
        query {
          me {
            id
            email
            role
          }
        }
      `,
      variables: {}
    });

    expect(result.data.me).toBeDefined();
    expect(result.data.me.role).toBe('CITIZEN');
  });

  it('should fetch paginated cases', async () => {
    const result = await query({
      query: gql`
        query {
          cases(first: 10, filter: { status: APPROVED }) {
            edges {
              node {
                id
                status
              }
            }
            pageInfo {
              totalCount
              hasNextPage
            }
          }
        }
      `
    });

    expect(result.data.cases.edges).toHaveLength(10);
    expect(result.data.cases.pageInfo.totalCount).toBeGreaterThan(0);
  });
});
```

---

## Documentation

- **Apollo Studio:** Hosted schema explorer (introspection)
- **GraphQL Playground:** Interactive query tool
- **Schema Reference:** Auto-generated from type definitions

---

**Document Version:** 1.0  
**Last Updated:** 2026-08-06  
**Status:** Ready for Implementation  
**Estimated Effort:** 20-30 hours
