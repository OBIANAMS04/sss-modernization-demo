jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../services/auditService', () => ({ ...jest.requireActual('../services/auditService'), recordAudit: jest.fn() }));

import express from 'express';
import request from 'supertest';
import { AppError } from '../utils/errors';
import { errorHandler } from './errorHandler';

// STORY-026: expected refusals and bad requests are warnings without a stack; only a real fault is logged at level error
describe('errorHandler log levels', () => {
  const app = express();
  app.get('/refused', () => {
    throw new AppError(403, 'Access denied', 'FORBIDDEN');
  });
  app.get('/bad', () => {
    throw new AppError(400, 'actor must be a user id', 'VALIDATION_ERROR');
  });
  app.get('/fault', () => {
    throw new Error('relation "notifications" does not exist');
  });
  app.use(errorHandler);

  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['/refused', 403],
    ['/bad', 400],
  ])('%s is one warning line with its status and no stack', async (path, status) => {
    expect((await request(app).get(path)).status).toBe(status);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [, data] = warn.mock.calls[0];
    expect(data).toMatchObject({ status, method: 'GET' });
    expect(data).not.toHaveProperty('stack');
  });

  it('a real fault is an error with its stack, and the caller gets a plain 500', async () => {
    const res = await request(app).get('/fault');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toHaveProperty('stack');
  });
});
