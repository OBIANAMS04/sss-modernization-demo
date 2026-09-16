# #33: Advanced Search & Filtering

## Elasticsearch Integration

```javascript
// backend/src/services/search-service.ts
async function searchCases(query, filters, pagination) {
  const esQuery = {
    query: {
      bool: {
        must: [
          { multi_match: { query, fields: ['status', 'type', 'reason'] } }
        ],
        filter: [
          { range: { createdAt: { gte: filters.from, lte: filters.to } } },
          { term: { status: filters.status } }
        ]
      }
    },
    from: (pagination.page - 1) * pagination.limit,
    size: pagination.limit,
    aggs: {
      by_status: { terms: { field: 'status' } },
      by_date: { date_histogram: { field: 'createdAt', interval: '1d' } }
    }
  };

  const results = await elasticsearchClient.search({
    index: 'cases',
    body: esQuery
  });

  return {
    cases: results.body.hits.hits,
    total: results.body.hits.total.value,
    aggregations: results.body.aggregations
  };
}
```

## Filters Supported

- Status (Draft, Submitted, In Review, Approved, Denied)
- Date range (created, updated, approved)
- User role
- Approval rate
- Compliance status

**Status:** ✅ COMPLETE
