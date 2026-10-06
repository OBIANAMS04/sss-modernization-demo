import type { Express } from 'express';

export interface RouteInfo {
  /** e.g. "GET /api/cases/:id" */
  key: string;
  method: string;
  path: string;
  /** Names of middleware that run before the handler: router-level ones first, then route-level. */
  guards: string[];
}

/** Turns an Express mount regexp such as /^\/api\/cases\/?(?=\/|$)/i back into "/api/cases". */
function mountPath(regexp: RegExp): string {
  return regexp.source
    .replace(/^\^/, '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/');
}

/** Lists every route the app serves, with the middleware chain in front of each handler. */
export function listRoutes(app: Express): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const stack: any[] = (app as any)._router?.stack ?? [];

  for (const layer of stack) {
    if (layer.route) {
      const handlers = layer.route.stack.map((s: any) => s.name);
      for (const method of Object.keys(layer.route.methods)) {
        const m = method.toUpperCase();
        routes.push({ key: `${m} ${layer.route.path}`, method: m, path: layer.route.path, guards: handlers.slice(0, -1) });
      }
      continue;
    }
    if (layer.name !== 'router') continue;

    const prefix = mountPath(layer.regexp);
    const routerMiddleware: string[] = [];
    for (const inner of layer.handle.stack) {
      if (!inner.route) {
        routerMiddleware.push(inner.name);
        continue;
      }
      const path = prefix + (inner.route.path === '/' ? '' : inner.route.path);
      const handlers = inner.route.stack.map((s: any) => s.name);
      for (const method of Object.keys(inner.route.methods)) {
        const m = method.toUpperCase();
        routes.push({ key: `${m} ${path}`, method: m, path, guards: [...routerMiddleware, ...handlers.slice(0, -1)] });
      }
    }
  }
  return routes;
}
