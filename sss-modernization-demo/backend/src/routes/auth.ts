import { Router, Request, Response, NextFunction } from 'express';
import { registerUser, loginUser } from '../services/authService';
import { validateRegistrationInput } from '../utils/validators';
import { ValidationError, AppError } from '../utils/errors';

const router = Router();

interface RegisterRequest extends Request {
  body: {
    email?: string;
    password?: string;
    fullName?: string;
    ssn?: string;
    dob?: string;
  };
}

interface LoginRequest extends Request {
  body: {
    email?: string;
    password?: string;
  };
}

// POST /auth/register
router.post('/register', async (req: RegisterRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password, fullName, ssn, dob } = req.body;

    // Validate input
    const validationErrors = validateRegistrationInput({
      email,
      password,
      fullName,
      ssn,
      dob,
    });

    if (validationErrors.length > 0) {
      const fieldErrors: Record<string, string> = {};
      validationErrors.forEach((err) => {
        fieldErrors[err.field] = err.message;
      });
      throw new ValidationError('Validation failed', fieldErrors);
    }

    // Register user
    const result = await registerUser({
      email: email!,
      password: password!,
      fullName: fullName!,
      ssn: ssn!,
      dob: dob!,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

// POST /auth/login
router.post('/login', async (req: LoginRequest, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    const result = await loginUser(email, password);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
