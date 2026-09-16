import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
  });

  if (err instanceof AppError) {
    const response: any = {
      error: {
        message: err.message,
        code: err.code,
      },
    };

    return res.status(err.statusCode).json(response);
  }

  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
}
