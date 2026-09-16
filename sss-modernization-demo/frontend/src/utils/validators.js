export const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

export const validatePassword = (password) => {
  // Must match backend: min 12 chars, 1 uppercase, 1 digit, 1 special char
  const re = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{12,}$/;
  return re.test(password);
};

export const validateFullName = (fullName) => {
  return fullName.trim().length >= 2;
};

export const validateSSN = (ssn) => {
  const re = /^\d{3}-\d{2}-\d{4}$/;
  return re.test(ssn);
};

export const formatSSN = (value) => {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

export const validateDateOfBirth = (dob) => {
  const date = new Date(dob);
  if (isNaN(date.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age--;
  }
  return age >= 18;
};
