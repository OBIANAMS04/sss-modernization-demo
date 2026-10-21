import { NextFunction, Request, Response } from 'express';

/**
 * STORY-041: security headers on every API response. The API answers JSON only, so the content policy allows nothing to load or frame
 * it; responses carry personal data, so none is cached; and browsers must keep to HTTPS and not guess content types. (The site's own
 * headers are set where it is served; see docs/SECURITY-TESTING.md.)
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cache-Control': 'no-store',
  });
  next();
}
