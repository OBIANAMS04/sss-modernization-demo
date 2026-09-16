import pool from '../database/connection';
import { NotFoundError, ValidationError } from '../utils/errors';

export type CaseStatus = 'Draft' | 'Submitted' | 'In Review' | 'Approved' | 'Denied' | 'Appealed';

export interface CaseData {
  id: string;
  userId: string;
  exemptionId?: string;
  status: CaseStatus;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  approvedAt?: string;
}

export interface CaseNote {
  id: string;
  caseId: string;
  noteBy: string;
  content: string;
  createdAt: string;
}

export interface CaseDocument {
  id: string;
  caseId: string;
  documentType: string;
  documentUrl: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface CreateCaseInput {
  userId: string;
  exemptionId?: string;
}

export interface UpdateCaseInput {
  status?: CaseStatus;
  assignedTo?: string;
  notes?: string;
}

const VALID_STATUSES: CaseStatus[] = ['Draft', 'Submitted', 'In Review', 'Approved', 'Denied', 'Appealed'];

export async function createCase(input: CreateCaseInput): Promise<CaseData> {
  const result = await pool.query(
    `INSERT INTO cases (user_id, exemption_id, status)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, exemption_id, status, assigned_to, created_at, updated_at, submitted_at, approved_at`,
    [input.userId, input.exemptionId || null, 'Draft']
  );

  const row = result.rows[0];
  return mapRowToCase(row);
}

export async function getCaseById(caseId: string): Promise<CaseData & { notes: CaseNote[]; documents: CaseDocument[] }> {
  const caseResult = await pool.query(
    `SELECT id, user_id, exemption_id, status, assigned_to, created_at, updated_at, submitted_at, approved_at
     FROM cases WHERE id = $1`,
    [caseId]
  );

  if (caseResult.rows.length === 0) {
    throw new NotFoundError('Case not found');
  }

  const caseData = mapRowToCase(caseResult.rows[0]);

  // Load notes and documents
  const notesResult = await pool.query(
    `SELECT id, case_id, note_by, content, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC`,
    [caseId]
  );

  const docsResult = await pool.query(
    `SELECT id, case_id, document_type, document_url, uploaded_by, created_at FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC`,
    [caseId]
  );

  return {
    ...caseData,
    notes: notesResult.rows.map(mapRowToNote),
    documents: docsResult.rows.map(mapRowToDocument),
  };
}

export async function getCasesByUserId(
  userId: string,
  page: number = 1,
  limit: number = 10
): Promise<{ cases: CaseData[]; total: number }> {
  const offset = (page - 1) * limit;

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM cases WHERE user_id = $1`,
    [userId]
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const result = await pool.query(
    `SELECT id, user_id, exemption_id, status, assigned_to, created_at, updated_at, submitted_at, approved_at
     FROM cases WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return {
    cases: result.rows.map(mapRowToCase),
    total,
  };
}

export async function getAllCases(
  filters?: { status?: CaseStatus; assignedTo?: string },
  page: number = 1,
  limit: number = 20
): Promise<{ cases: CaseData[]; total: number }> {
  let query = 'SELECT COUNT(*) as total FROM cases WHERE 1=1';
  let countParams: any[] = [];

  if (filters?.status) {
    query += ` AND status = $${countParams.length + 1}`;
    countParams.push(filters.status);
  }
  if (filters?.assignedTo) {
    query += ` AND assigned_to = $${countParams.length + 1}`;
    countParams.push(filters.assignedTo);
  }

  const countResult = await pool.query(query, countParams);
  const total = parseInt(countResult.rows[0].total, 10);

  const offset = (page - 1) * limit;
  let selectQuery = 'SELECT id, user_id, exemption_id, status, assigned_to, created_at, updated_at, submitted_at, approved_at FROM cases WHERE 1=1';
  let selectParams: any[] = [];

  if (filters?.status) {
    selectQuery += ` AND status = $${selectParams.length + 1}`;
    selectParams.push(filters.status);
  }
  if (filters?.assignedTo) {
    selectQuery += ` AND assigned_to = $${selectParams.length + 1}`;
    selectParams.push(filters.assignedTo);
  }

  selectQuery += ` ORDER BY created_at DESC LIMIT $${selectParams.length + 1} OFFSET $${selectParams.length + 2}`;
  selectParams.push(limit, offset);

  const result = await pool.query(selectQuery, selectParams);

  return {
    cases: result.rows.map(mapRowToCase),
    total,
  };
}

export async function updateCase(caseId: string, input: UpdateCaseInput): Promise<CaseData> {
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    throw new ValidationError(`Invalid status: ${input.status}`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (input.status) {
      updates.push(`status = $${paramCount}`);
      values.push(input.status);
      paramCount++;

      // Set submitted_at if transitioning to Submitted
      if (input.status === 'Submitted') {
        updates.push(`submitted_at = NOW()`);
      }

      // Set approved_at if transitioning to Approved
      if (input.status === 'Approved') {
        updates.push(`approved_at = NOW()`);
      }
    }

    if (input.assignedTo !== undefined) {
      updates.push(`assigned_to = $${paramCount}`);
      values.push(input.assignedTo || null);
      paramCount++;
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // No actual updates
      return await getCaseById(caseId);
    }

    values.push(caseId);
    const result = await client.query(
      `UPDATE cases SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, user_id, exemption_id, status, assigned_to, created_at, updated_at, submitted_at, approved_at`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Case not found');
    }

    // Add note if provided
    if (input.notes) {
      await addCaseNote(client, caseId, 'system', input.notes);
    }

    await client.query('COMMIT');
    return mapRowToCase(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function addCaseNote(
  client: any,
  caseId: string,
  noteBy: string,
  content: string
): Promise<CaseNote> {
  const result = await client.query(
    `INSERT INTO case_notes (case_id, note_by, content)
     VALUES ($1, $2, $3)
     RETURNING id, case_id, note_by, content, created_at`,
    [caseId, noteBy, content]
  );

  return mapRowToNote(result.rows[0]);
}

export async function getCaseNotes(caseId: string): Promise<CaseNote[]> {
  const result = await pool.query(
    `SELECT id, case_id, note_by, content, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC`,
    [caseId]
  );

  return result.rows.map(mapRowToNote);
}

export async function addCaseDocument(
  caseId: string,
  documentType: string,
  documentUrl: string,
  uploadedBy?: string
): Promise<CaseDocument> {
  const result = await pool.query(
    `INSERT INTO case_documents (case_id, document_type, document_url, uploaded_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, case_id, document_type, document_url, uploaded_by, created_at`,
    [caseId, documentType, documentUrl, uploadedBy || null]
  );

  return mapRowToDocument(result.rows[0]);
}

export async function getCaseDocuments(caseId: string): Promise<CaseDocument[]> {
  const result = await pool.query(
    `SELECT id, case_id, document_type, document_url, uploaded_by, created_at FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC`,
    [caseId]
  );

  return result.rows.map(mapRowToDocument);
}

export async function getCaseStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  averageTimeInReview: number;
}> {
  const totalResult = await pool.query('SELECT COUNT(*) as total FROM cases');
  const byStatusResult = await pool.query(
    `SELECT status, COUNT(*) as count FROM cases GROUP BY status`
  );

  const timeResult = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (CASE WHEN updated_at > submitted_at THEN updated_at - submitted_at ELSE NULL END))) as avg_seconds
     FROM cases WHERE submitted_at IS NOT NULL`
  );

  const byStatus: Record<string, number> = {};
  for (const row of byStatusResult.rows) {
    byStatus[row.status] = parseInt(row.count, 10);
  }

  return {
    total: parseInt(totalResult.rows[0].total, 10),
    byStatus,
    averageTimeInReview: timeResult.rows[0]?.avg_seconds ? Math.round(timeResult.rows[0].avg_seconds / 3600) : 0, // hours
  };
}

// Helper functions
function mapRowToCase(row: any): CaseData {
  return {
    id: row.id,
    userId: row.user_id,
    exemptionId: row.exemption_id,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
  };
}

function mapRowToNote(row: any): CaseNote {
  return {
    id: row.id,
    caseId: row.case_id,
    noteBy: row.note_by,
    content: row.content,
    createdAt: row.created_at,
  };
}

function mapRowToDocument(row: any): CaseDocument {
  return {
    id: row.id,
    caseId: row.case_id,
    documentType: row.document_type,
    documentUrl: row.document_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}
