// The eligibility rules, as pure functions (moved from the retired src/routes/exemptions.test.ts; the route itself is tested end to end).
import {
  checkExemptionEligibility,
  calculateAge,
} from './exemptionService';

describe('Exemption Service', () => {
  describe('calculateAge', () => {
    it('should calculate age correctly', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 30);
      const age = calculateAge(dob.toLocaleDateString('en-CA'));

      expect(age).toBe(30);
    });

    it('should calculate age for senior (65+)', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 70);
      const age = calculateAge(dob.toLocaleDateString('en-CA'));

      expect(age).toBe(70);
    });

    it('should calculate age correctly before birthday', () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 30);
      dob.setMonth(dob.getMonth() + 1); // Birthday is next month
      const age = calculateAge(dob.toLocaleDateString('en-CA'));

      expect(age).toBe(29);
    });
  });

  describe('checkExemptionEligibility', () => {
    it('should return no exemptions for young person with no hardship', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 25);
          return d.toLocaleDateString('en-CA');
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 50000,
        hasDocumentedHardship: false,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(false);
      expect(result.exemptions).toHaveLength(0);
    });

    it('should return Type A exemption for senior (65+)', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 70);
          return d.toLocaleDateString('en-CA');
        })(),
        phone: '1234567890',
        address: '123 Main St',
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type A - Senior Exemption');
    });

    it('should return Type B exemption for low income', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 30);
          return d.toLocaleDateString('en-CA');
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 15000,
        hasDocumentedHardship: false,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type B - Income-Based Exemption');
    });

    it('should return Type C exemption for documented hardship', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 30);
          return d.toLocaleDateString('en-CA');
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 50000,
        hasDocumentedHardship: true,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions).toContain('Type C - Hardship Exemption (Pending Review)');
    });

    it('should return multiple exemptions for senior with low income', () => {
      const user = {
        id: '123',
        dob: (() => {
          const d = new Date();
          d.setFullYear(d.getFullYear() - 70);
          return d.toLocaleDateString('en-CA');
        })(),
        phone: '1234567890',
        address: '123 Main St',
        income: 15000,
      };

      const result = checkExemptionEligibility(user);

      expect(result.eligible).toBe(true);
      expect(result.exemptions.length).toBeGreaterThan(1);
      expect(result.exemptions).toContain('Type A - Senior Exemption');
      expect(result.exemptions).toContain('Type B - Income-Based Exemption');
    });

    const yearsAgo = (n: number) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - n);
      return d.toLocaleDateString('en-CA');
    };
    const statusOf = (result: ReturnType<typeof checkExemptionEligibility>, type: string) =>
      result.evaluations.find((e) => e.exemptionType === type);

    it('should give every exemption type a status and a reason', () => {
      const result = checkExemptionEligibility({ id: '1', dob: yearsAgo(30), income: 50000 });

      expect(result.evaluations.map((e) => e.exemptionType)).toEqual(['Type A', 'Type B', 'Type C']);
      for (const e of result.evaluations) {
        expect(e.status).toBe('Not Eligible');
        expect(e.reason.length).toBeGreaterThan(0);
      }
      expect(statusOf(result, 'Type A')?.reason).toBe('Applicant is under 65.');
      expect(statusOf(result, 'Type B')?.reason).toBe('Annual income is at or above the $20,000 threshold.');
      expect(statusOf(result, 'Type C')?.reason).toBe('No documented hardship on file.');
    });

    it('should treat zero income as below the threshold', () => {
      const result = checkExemptionEligibility({ id: '1', dob: yearsAgo(30), income: 0 });

      expect(statusOf(result, 'Type B')?.status).toBe('Eligible');
      expect(result.exemptions).toContain('Type B - Income-Based Exemption');
    });

    it('should explain that income is missing rather than silently denying Type B', () => {
      const result = checkExemptionEligibility({ id: '1', dob: yearsAgo(30), income: null });

      expect(statusOf(result, 'Type B')?.status).toBe('Not Eligible');
      expect(statusOf(result, 'Type B')?.reason).toMatch(/No annual income on file/);
    });

    it('should mark documented hardship as Pending Review, not auto-approved', () => {
      const result = checkExemptionEligibility({ id: '1', dob: yearsAgo(30), hasDocumentedHardship: true });

      expect(statusOf(result, 'Type C')?.status).toBe('Pending Review');
      expect(result.eligible).toBe(true);
    });

    it('should treat the 65th birthday as the Type A cutoff', () => {
      expect(statusOf(checkExemptionEligibility({ id: '1', dob: yearsAgo(65) }), 'Type A')?.status).toBe('Eligible');

      const almost65 = new Date();
      almost65.setFullYear(almost65.getFullYear() - 65);
      almost65.setDate(almost65.getDate() + 1); // turns 65 tomorrow
      const dob = almost65.toLocaleDateString('en-CA');
      expect(statusOf(checkExemptionEligibility({ id: '1', dob }), 'Type A')?.status).toBe('Not Eligible');
    });

    it('should never echo the applicant income in a reason', () => {
      const result = checkExemptionEligibility({ id: '1', dob: yearsAgo(30), income: 12345 });

      for (const e of result.evaluations) {
        expect(e.reason).not.toContain('12345');
        expect(e.reason).not.toContain('12,345');
      }
    });
  });
});

