import { DecisionContext, evaluateControls, DECISION_CONTROLS } from './complianceService';

const compliantApproval: DecisionContext = {
  decision: 'Approved',
  applicantId: 'applicant-1',
  deciderId: 'manager-1',
  deciderEmail: 'manager@example.com',
  assignedTo: 'manager@example.com',
  fromStatus: 'In Review',
  reason: null,
  exemptionType: 'Type B',
  exemptionStatus: 'Eligible',
  exemptionReason: 'Annual income is below the $20,000 threshold.',
  determinedAt: new Date('2026-10-06T10:05:00Z'),
  profileUpdatedAt: new Date('2026-10-06T10:00:00Z'),
  applicantNotified: true,
  auditLogged: true,
  documentTypes: ['income_statement'],
};

const compliantDenial: DecisionContext = {
  ...compliantApproval,
  decision: 'Denied',
  reason: 'Income statement does not cover the last tax year.',
  documentTypes: [],
};

const failedIds = (ctx: DecisionContext) =>
  evaluateControls(ctx)
    .filter((r) => !r.passed)
    .map((r) => r.controlId);

describe('decision controls', () => {
  it('passes every applicable control for a well-formed approval', () => {
    const results = evaluateControls(compliantApproval);
    expect(results.map((r) => r.controlId)).toEqual(['CTRL-01', 'CTRL-02', 'CTRL-04', 'CTRL-05', 'CTRL-06', 'CTRL-07', 'CTRL-08']);
    expect(failedIds(compliantApproval)).toEqual([]);
  });

  it('applies the denial controls (grounds for denial) but not the approval-only ones', () => {
    const results = evaluateControls(compliantDenial);
    expect(results.map((r) => r.controlId)).toEqual(['CTRL-02', 'CTRL-03', 'CTRL-04', 'CTRL-05', 'CTRL-06', 'CTRL-08']);
    expect(failedIds(compliantDenial)).toEqual([]);
  });

  it('CTRL-01 fails an approval the applicant is not eligible for', () => {
    expect(failedIds({ ...compliantApproval, exemptionStatus: 'Not Eligible' })).toEqual(['CTRL-01']);
  });

  it('CTRL-01 accepts approving a hardship case that is Pending Review', () => {
    const ctx = { ...compliantApproval, exemptionType: 'Type C', exemptionStatus: 'Pending Review', documentTypes: ['hardship_evidence'] };
    expect(failedIds(ctx)).toEqual([]);
  });

  it('CTRL-02 fails when eligibility was not re-checked after the last profile change', () => {
    const ctx = { ...compliantApproval, determinedAt: new Date('2026-10-06T09:00:00Z') };
    expect(failedIds(ctx)).toEqual(['CTRL-02']);
    expect(failedIds({ ...compliantApproval, determinedAt: null })).toEqual(['CTRL-02']);
  });

  it('CTRL-03 fails a denial without a reason or without notifying the applicant', () => {
    expect(failedIds({ ...compliantDenial, reason: '  ' })).toEqual(['CTRL-03']);
    expect(failedIds({ ...compliantDenial, applicantNotified: false })).toEqual(['CTRL-03']);
  });

  it('CTRL-04 fails when the applicant decides their own case', () => {
    expect(failedIds({ ...compliantApproval, deciderId: 'applicant-1' })).toEqual(['CTRL-04']);
  });

  it('CTRL-05 fails when the decider is not the assigned case manager, case-insensitively', () => {
    expect(failedIds({ ...compliantApproval, assignedTo: null })).toEqual(['CTRL-05']);
    expect(failedIds({ ...compliantApproval, assignedTo: 'someone-else@example.com' })).toEqual(['CTRL-05']);
    expect(failedIds({ ...compliantApproval, assignedTo: 'Manager@Example.com' })).toEqual([]);
  });

  it('CTRL-06 fails a decision that skipped review', () => {
    expect(failedIds({ ...compliantApproval, fromStatus: 'Submitted' })).toEqual(['CTRL-06']);
  });

  it('CTRL-07 requires the document that matches the exemption type', () => {
    expect(failedIds({ ...compliantApproval, documentTypes: [] })).toEqual(['CTRL-07']);
    expect(failedIds({ ...compliantApproval, documentTypes: ['proof_of_age'] })).toEqual(['CTRL-07']);
    expect(failedIds({ ...compliantApproval, exemptionType: 'Type A', documentTypes: ['proof_of_age'] })).toEqual([]);
  });

  it('CTRL-08 fails when the decision is missing from the audit log', () => {
    expect(failedIds({ ...compliantApproval, auditLogged: false })).toEqual(['CTRL-08']);
  });

  it('gives every result evidence text', () => {
    for (const r of [...evaluateControls(compliantApproval), ...evaluateControls(compliantDenial)]) {
      expect(r.evidence.length).toBeGreaterThan(10);
    }
  });

  it('defines eight controls, each citing a reference and an evidence source', () => {
    expect(DECISION_CONTROLS).toHaveLength(8);
    for (const c of DECISION_CONTROLS) {
      expect(c.reference).toBeTruthy();
      expect(c.evidenceSource).toBeTruthy();
      expect(c.appliesTo.length).toBeGreaterThan(0);
    }
  });
});
