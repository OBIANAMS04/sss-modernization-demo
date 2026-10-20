// STORY-021 (4): a change of model or of the policy documents' version is recorded once, when it is noticed.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./caseEvents', () => ({ inTransaction: jest.fn() }));

import pool from '../database/connection';
import { inTransaction } from './caseEvents';
import { listMarkers, noteChange, resetMarkerCache } from './changeMarkers';

const transaction = inTransaction as jest.Mock;
const query = pool.query as unknown as jest.Mock;

/** A database whose latest marker of any kind is `latest`. */
function database(latest: string | null) {
  const client = {
    query: jest.fn(async (sql: string) => (/SELECT to_value/.test(sql) ? { rows: latest ? [{ to_value: latest }] : [] } : { rows: [] })),
  };
  transaction.mockReset().mockImplementation(async (work: any) => work(client));
  return client;
}
const inserts = (client: { query: jest.Mock }) => client.query.mock.calls.filter(([sql]) => /INSERT INTO assistant_change_markers/.test(sql));

beforeEach(() => resetMarkerCache());

describe('noteChange', () => {
  it('records the first model ever seen, from nothing', async () => {
    const client = database(null);
    expect(await noteChange('model', 'claude-opus-5-5')).toBe(true);
    expect(inserts(client)[0][1].slice(0, 3)).toEqual(['model', null, 'claude-opus-5-5']);
  });

  it('records a change, with what it changed from', async () => {
    const client = database('claude-opus-5-5');
    expect(await noteChange('model', 'claude-sonnet-5-5', new Date('2026-10-20T10:00:00Z'))).toBe(true);
    expect(inserts(client)[0][1]).toEqual(['model', 'claude-opus-5-5', 'claude-sonnet-5-5', new Date('2026-10-20T10:00:00Z')]);
  });

  it('records nothing when the latest marker is already this value', async () => {
    const client = database('abc123');
    expect(await noteChange('corpus', 'abc123')).toBe(false);
    expect(inserts(client)).toHaveLength(0);
  });

  it('does not even look at the database again for a value this process has already seen', async () => {
    database('claude-opus-5-5');
    await noteChange('model', 'claude-opus-5-5');
    transaction.mockClear();
    expect(await noteChange('model', 'claude-opus-5-5')).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('ignores a missing model, such as an answer made without one', async () => {
    database(null);
    expect(await noteChange('model', null)).toBe(false);
    expect(await noteChange('model', undefined)).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('listMarkers', () => {
  it('lists the markers of a number of days, oldest first', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'm1', kind: 'corpus', from_value: 'a', to_value: 'b', at: '2026-10-19T00:00:00Z' }] });
    expect(await listMarkers(35)).toEqual([{ id: 'm1', kind: 'corpus', from: 'a', to: 'b', at: '2026-10-19T00:00:00Z' }]);
    expect(query.mock.calls[0][1]).toEqual([35]);
  });
});
