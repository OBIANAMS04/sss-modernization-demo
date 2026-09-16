export interface ValidationError {
  field: string;
  message: string;
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password: string): boolean {
  // Min 12 chars, 1 uppercase, 1 digit, 1 special char
  const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{12,}$/;
  return passwordRegex.test(password);
}

export function validateSSN(ssn: string): boolean {
  // XXX-XX-XXXX format
  const ssnRegex = /^\d{3}-\d{2}-\d{4}$/;
  return ssnRegex.test(ssn);
}

export function validateDateOfBirth(dob: string): boolean {
  const date = new Date(dob);
  if (isNaN(date.getTime())) return false;
  // Check DOB is not in future and person is at least 18 years old
  const today = new Date();
  const age = today.getFullYear() - date.getFullYear();
  return age >= 18;
}

export function validateRegistrationInput(data: {
  email?: string;
  password?: string;
  fullName?: string;
  ssn?: string;
  dob?: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.email || !validateEmail(data.email)) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }

  if (!data.password || !validatePassword(data.password)) {
    errors.push({
      field: 'password',
      message: 'Password must be at least 12 characters with uppercase, digit, and special character',
    });
  }

  if (!data.fullName || data.fullName.trim().length === 0) {
    errors.push({ field: 'fullName', message: 'Full name is required' });
  }

  if (!data.ssn || !validateSSN(data.ssn)) {
    errors.push({ field: 'ssn', message: 'Invalid SSN format (XXX-XX-XXXX)' });
  }

  if (!data.dob || !validateDateOfBirth(data.dob)) {
    errors.push({ field: 'dob', message: 'Must be at least 18 years old' });
  }

  return errors;
}
