// STORY-026: nothing personal in a span, a log line or an error record. These patterns are the last line of defence: the code
// that logs or traces is written to leave personal data out in the first place, and this removes what slips through anyway
// (an error message that echoes a value, a stack trace that names an email address).

const SSN_PATTERNS = [/\b\d{3}[\s\-‐-―]\d{2}[\s\-‐-―]\d{4}\b/g, /\b\d{9}\b/g];
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Text with Social Security numbers and email addresses removed. */
export function scrubText(text: string): string {
  let clean = text.replace(EMAIL, '[email]');
  for (const pattern of SSN_PATTERNS) clean = clean.replace(pattern, '[REDACTED]');
  return clean;
}

/**
 * The template of a route as the access table names it ("GET /api/cases/:id"), never the raw path: a raw path holds record ids and a
 * query string can hold anything. A request that no route matched is one bucket, so a scanner cannot create unlimited labels.
 */
export const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export function routeTemplate(method: string, baseUrl: string, routePath: unknown): string {
  const verb = KNOWN_METHODS.has(method) ? method : 'OTHER';
  if (typeof routePath !== 'string') return `${verb} (unmatched)`;
  const path = `${baseUrl}${routePath === '/' ? '' : routePath}`;
  return `${verb} ${path || '/'}`;
}

/** Span attributes that can carry a raw path, a query string, an address, a browser or SQL text. Removed before a span leaves the server. */
const UNSAFE_ATTRIBUTES = new Set([
  'url.full', 'url.path', 'url.query', 'http.url', 'http.target', 'http.route.raw', 'http.user_agent', 'user_agent.original',
  'client.address', 'client.port', 'net.peer.ip', 'net.peer.port', 'network.peer.address', 'network.peer.port', 'http.client_ip',
  'db.statement', 'db.query.text', 'db.user', 'db.connection_string', 'server.address', 'server.port', 'net.host.name', 'net.host.port',
  'http.host', 'url.scheme', 'http.request.header.cookie', 'http.request.header.authorization',
]);

/** A span with the unsafe attributes removed and its name made from the route template. Mutates and returns the span. */
export function scrubSpan<T extends { attributes: Record<string, unknown>; name: string }>(span: T): T {
  const attributes = span.attributes;
  for (const key of Object.keys(attributes)) {
    if (UNSAFE_ATTRIBUTES.has(key) || key.startsWith('http.request.header.') || key.startsWith('http.response.header.')) delete attributes[key];
    else if (typeof attributes[key] === 'string') attributes[key] = scrubText(attributes[key] as string);
  }
  // The SQL text is gone; the operation ("SELECT") is enough to read a trace
  span.name = scrubText(span.name);
  return span;
}
