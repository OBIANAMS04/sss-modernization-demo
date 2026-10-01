import { allowedTransitions, csvCell } from './caseService';

describe('case workflow rules', () => {
  it('lets applicants only submit drafts and appeal denials', () => {
    expect(allowedTransitions('Draft', 'applicant')).toEqual(['Submitted']);
    expect(allowedTransitions('Denied', 'applicant')).toEqual(['Appealed']);
    expect(allowedTransitions('Submitted', 'applicant')).toEqual([]);
    expect(allowedTransitions('In Review', 'applicant')).toEqual([]);
  });

  it('lets staff review and decide, but not skip review', () => {
    expect(allowedTransitions('Submitted', 'staff')).toEqual(['In Review']);
    expect(allowedTransitions('In Review', 'staff')).toEqual(['Approved', 'Denied']);
    expect(allowedTransitions('Appealed', 'staff')).toEqual(['In Review']);
    expect(allowedTransitions('Submitted', 'staff')).not.toContain('Approved');
  });

  it('treats Approved as final for everyone', () => {
    expect(allowedTransitions('Approved', 'staff')).toEqual([]);
    expect(allowedTransitions('Approved', 'applicant')).toEqual([]);
  });

  it('does not let staff appeal or submit on an applicant\'s behalf', () => {
    expect(allowedTransitions('Denied', 'staff')).toEqual([]);
    expect(allowedTransitions('Draft', 'staff')).toEqual([]);
  });
});

describe('csvCell', () => {
  it('quotes values and doubles embedded quotes', () => {
    expect(csvCell('Doe, "Jane"')).toBe('"Doe, ""Jane"""');
  });

  it('renders empty values as an empty quoted cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1-555')).toBe('"\'+1-555"');
    expect(csvCell('-cmd')).toBe('"\'-cmd"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
  });

  it('formats dates as ISO strings', () => {
    expect(csvCell(new Date('2026-10-01T12:00:00Z'))).toBe('"2026-10-01T12:00:00.000Z"');
  });
});
