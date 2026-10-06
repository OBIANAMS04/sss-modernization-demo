import { Router, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { authenticate } from '../middleware/authenticate';
import { requireStaff } from '../middleware/requireStaff';
import { getUserRole, isStaff } from '../services/roleService';
import {
  Actor,
  CaseFilters,
  DOCUMENT_TYPES,
  addDocument,
  addNote,
  allowedTransitions,
  applyForExemption,
  assignCase,
  changeStatus,
  exportCasesCsv,
  getCaseDetail,
  getCaseStats,
  getCasesByUserId,
  getStaffMembers,
  listCases,
} from '../services/caseService';

const router = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(authenticate);

async function actorFrom(req: any): Promise<Actor> {
  return { id: req.user.sub, email: req.user.email, role: await getUserRole(req.user.sub) };
}

function filtersFrom(query: any): CaseFilters {
  return {
    status: query.status || undefined,
    exemptionType: query.exemptionType || undefined,
    assignedTo: query.assignedTo || undefined,
    applicant: query.applicant || undefined,
    openOnly: query.openOnly === 'true',
  };
}

/** Loads the case for its owner or staff, with the actions this viewer may take. */
async function loadCaseForViewer(req: any) {
  const { id } = req.params;
  if (!UUID_PATTERN.test(id)) throw new AppError(404, 'Case not found', 'NOT_FOUND');

  const actor = await actorFrom(req);
  const staff = isStaff(actor.role);
  const detail = await getCaseDetail(id, staff);
  const isApplicant = detail.userId === actor.id;
  if (!isApplicant && !staff) throw new AppError(403, 'Access denied', 'FORBIDDEN');

  // Staff never review their own case: on it they only get applicant actions.
  const reviewer = staff && !isApplicant;
  const actions = {
    transitions: allowedTransitions(detail.status, isApplicant ? 'applicant' : 'staff'),
    canAssign: reviewer,
    canAddNote: reviewer,
    canAddDocument: true,
  };
  return { actor, detail, actions, reviewer };
}

// POST /cases - Applicant applies for one of their own exemptions
router.post('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { exemptionId } = req.body;
    if (!exemptionId || !UUID_PATTERN.test(exemptionId)) {
      throw new AppError(400, 'exemptionId is required', 'VALIDATION_ERROR');
    }
    res.status(201).json(await applyForExemption(exemptionId, await actorFrom(req)));
  } catch (error) {
    next(error);
  }
});

// The fixed paths below are declared before /:id so they are reachable.

// GET /cases/managers - Staff members a case can be assigned to
router.get('/managers', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json({ managers: await getStaffMembers() });
  } catch (error) {
    next(error);
  }
});

// GET /cases/export - CSV of cases matching the filters (staff only). Never includes SSNs.
router.get('/export', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const csv = await exportCasesCsv(filtersFrom(req.query));
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sss-cases-${date}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /cases/stats - Case statistics (staff only)
router.get('/stats', requireStaff, async (_req: any, res: Response, next: NextFunction) => {
  try {
    res.json(await getCaseStats());
  } catch (error) {
    next(error);
  }
});

// GET /cases - The caller's own cases, or all cases (filtered) with scope=all for staff
router.get('/', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { scope, page = 1, limit = 25 } = req.query;
    if (scope === 'all') {
      if (!isStaff(await getUserRole(req.user.sub))) {
        throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
      }
      res.json(await listCases(filtersFrom(req.query), parseInt(page, 10) || 1, parseInt(limit, 10) || 25));
    } else {
      const cases = await getCasesByUserId(req.user.sub);
      res.json({ cases, total: cases.length, page: 1 });
    }
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id - Case detail with timeline and the viewer's allowed actions
router.get('/:id', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { detail, actions } = await loadCaseForViewer(req);
    res.json({ ...detail, actions, documentTypes: DOCUMENT_TYPES });
  } catch (error) {
    next(error);
  }
});

// POST /cases/:id/status - { status, reason } (rules enforced in the service)
router.post('/:id/status', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { actor } = await loadCaseForViewer(req);
    res.json(await changeStatus(req.params.id, req.body.status, actor, req.body.reason));
  } catch (error) {
    next(error);
  }
});

// PUT /cases/:id/assignment - { assignedTo: email | null } (staff, not on their own case)
router.put('/:id/assignment', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { actor, reviewer } = await loadCaseForViewer(req);
    if (!reviewer) throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    res.json(await assignCase(req.params.id, req.body.assignedTo || null, actor));
  } catch (error) {
    next(error);
  }
});

// POST /cases/:id/notes - Internal note (staff, not on their own case)
router.post('/:id/notes', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { actor, reviewer } = await loadCaseForViewer(req);
    if (!reviewer) throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    res.status(201).json(await addNote(req.params.id, req.body.content, actor));
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/notes - Internal notes (staff only)
router.get('/:id/notes', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { detail, reviewer } = await loadCaseForViewer(req);
    if (!reviewer) throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    res.json({ notes: detail.notes });
  } catch (error) {
    next(error);
  }
});

// POST /cases/:id/documents - { documentType, documentUrl } (owner or staff)
router.post('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { actor } = await loadCaseForViewer(req);
    const { documentType, documentUrl } = req.body;
    if (!documentType || !documentUrl) {
      throw new AppError(400, 'documentType and documentUrl are required', 'VALIDATION_ERROR');
    }
    res.status(201).json(await addDocument(req.params.id, documentType, documentUrl, actor));
  } catch (error) {
    next(error);
  }
});

// GET /cases/:id/documents - (owner or staff)
router.get('/:id/documents', async (req: any, res: Response, next: NextFunction) => {
  try {
    const { detail } = await loadCaseForViewer(req);
    res.json({ documents: detail.documents });
  } catch (error) {
    next(error);
  }
});

// PUT /cases/:id - { status, reason, assignedTo, notes } in one call (staff reviewer).
// Kept for the original STORY-007 API; the UI uses the specific endpoints above.
router.put('/:id', requireStaff, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { actor, reviewer } = await loadCaseForViewer(req);
    if (!reviewer) throw new AppError(403, 'Case manager access required', 'FORBIDDEN');
    const { status, reason, assignedTo, notes } = req.body;
    if (assignedTo !== undefined) await assignCase(req.params.id, assignedTo || null, actor);
    if (notes) await addNote(req.params.id, notes, actor);
    if (status) await changeStatus(req.params.id, status, actor, reason);
    res.json(await getCaseDetail(req.params.id, true));
  } catch (error) {
    next(error);
  }
});

export default router;
