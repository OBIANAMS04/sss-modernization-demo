// STORY-016: the attributes of the record a request is about, as the access policy is given them.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { loadResource } from './policyResources';

const query = pool.query as unknown as jest.Mock;
const ID = '44444444-4444-4444-8444-444444444444';
const OWNER = '11111111-1111-4111-8111-111111111111';
const MANAGER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => query.mockReset());

describe('a case', () => {
  it('comes back with its owner, who it is assigned to, its status and whether a review is open', async () => {
    query.mockResolvedValue({ rows: [{ owner_id: OWNER, assigned_to: MANAGER, status: 'In Review', under_compliance_review: true }] });

    expect(await loadResource('case', ID)).toEqual({
      type: 'case',
      found: true,
      owner_id: OWNER,
      assigned_to: MANAGER,
      status: 'In Review',
      under_compliance_review: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([ID]);
  });

  it('is unassigned when no one is', async () => {
    query.mockResolvedValue({ rows: [{ owner_id: OWNER, assigned_to: null, status: 'Submitted', under_compliance_review: false }] });

    expect(await loadResource('case', ID)).toMatchObject({ assigned_to: null, under_compliance_review: false });
  });

  it('is assigned to a person, by their account id, though the case stores their email; an email with no account stays as it is', async () => {
    query.mockResolvedValue({ rows: [] });
    await loadResource('case', ID);
    const sql: string = query.mock.calls[0][0].replace(/\s+/g, ' ');

    expect(sql).toContain('COALESCE((SELECT u.id::text FROM users u WHERE u.email = c.assigned_to LIMIT 1), c.assigned_to) AS assigned_to');
    expect(sql).toContain(`EXISTS (SELECT 1 FROM compliance_reviews r WHERE r.case_id = c.id AND r.status = 'Open') AS under_compliance_review`);
  });

  it('is not found when there is no such case, and an id that is not an id is not even looked up', async () => {
    query.mockResolvedValue({ rows: [] });

    expect(await loadResource('case', ID)).toEqual({ type: 'case', found: false });
    for (const id of ['not-a-uuid', '', undefined, `${ID}0`, "1' OR '1'='1"]) {
      expect(await loadResource('case', id)).toEqual({ type: 'case', found: false });
    }
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reads an id in capitals, as the routes do', async () => {
    query.mockResolvedValue({ rows: [{ owner_id: OWNER, assigned_to: null, status: 'Draft', under_compliance_review: false }] });

    expect((await loadResource('case', ID.toUpperCase())).found).toBe(true);
  });
});

describe('an account', () => {
  it('is owned by itself', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    expect(await loadResource('account', OWNER)).toEqual({ type: 'account', found: true, owner_id: OWNER });
  });

  it('is not found when there is no such account, or the id is not an id', async () => {
    query.mockResolvedValue({ rows: [] });

    expect(await loadResource('account', OWNER)).toEqual({ type: 'account', found: false });
    expect(await loadResource('account', 'someone')).toEqual({ type: 'account', found: false });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('an audit trail', () => {
  it('belongs to the person it is about, and always exists, so nothing is looked up', async () => {
    expect(await loadResource('audit_trail', OWNER)).toEqual({ type: 'audit_trail', found: true, owner_id: OWNER });
    expect(await loadResource('audit_trail', 'not-an-id')).toEqual({ type: 'audit_trail', found: true, owner_id: 'not-an-id' });
    expect(await loadResource('audit_trail', undefined)).toEqual({ type: 'audit_trail', found: true, owner_id: null });
    expect(query).not.toHaveBeenCalled();
  });
});
