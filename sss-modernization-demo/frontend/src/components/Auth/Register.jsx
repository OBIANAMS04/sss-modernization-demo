import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { setToken, setUser } from '../../utils/tokenManager';
import { validateEmail, validatePassword, validateFullName, validateSSN, formatSSN, validateDateOfBirth } from '../../utils/validators';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import { getApiErrorMessage } from '../../utils/apiError';
import usePageTitle from '../../utils/usePageTitle';

// Input ids in form order, so a failed submit can move focus to the first invalid field
const FIELD_IDS = {
  email: 'register-email',
  full_name: 'register-fullName',
  ssn: 'register-ssn',
  dob: 'register-dob',
  password: 'register-password',
};

export default function Register() {
  usePageTitle('Create account');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    ssn: '',
    dob: ''
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showSSN, setShowSSN] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === 'ssn' ? formatSSN(value) : value;
    setFormData(prev => ({ ...prev, [name]: nextValue }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Invalid email format';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (!validatePassword(formData.password)) {
      newErrors.password = 'Password must be at least 12 characters with an uppercase letter, a digit, and a special character (!@#$%^&*)';
    }
    if (!formData.full_name) {
      newErrors.full_name = 'Full name is required';
    } else if (!validateFullName(formData.full_name)) {
      newErrors.full_name = 'Full name must be at least 2 characters';
    }
    if (!formData.ssn) {
      newErrors.ssn = 'SSN is required';
    } else if (!validateSSN(formData.ssn)) {
      newErrors.ssn = 'SSN must be in XXX-XX-XXXX format';
    }
    if (!formData.dob) {
      newErrors.dob = 'Date of birth is required';
    } else if (!validateDateOfBirth(formData.dob)) {
      newErrors.dob = 'You must be at least 18 years old';
    }
    setErrors(newErrors);
    const firstInvalid = Object.keys(FIELD_IDS).find((name) => newErrors[name]);
    if (firstInvalid) document.getElementById(FIELD_IDS[firstInvalid])?.focus();
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const response = await authService.register(
        formData.email,
        formData.password,
        formData.full_name,
        formData.ssn,
        formData.dob
      );
      setToken(response.token);
      setUser(response.user);
      navigate('/dashboard');
    } catch (err) {
      setErrors({ submit: getApiErrorMessage(err, 'Registration failed') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main" className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">SSS Platform</h1>
          <p className="text-gray-600 text-center mb-6">Create your account</p>

          <DemoEnvironmentBanner />

          {errors.submit && (
            <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <input
                id="register-email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                aria-required="true"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'register-email-error' : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent outline-none transition ${
                  errors.email ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.email && <p id="register-email-error" className="text-red-700 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="register-fullName" className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
              <input
                id="register-fullName"
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                placeholder="John Doe"
                autoComplete="name"
                aria-required="true"
                aria-invalid={errors.full_name ? 'true' : undefined}
                aria-describedby={errors.full_name ? 'register-fullName-error' : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent outline-none transition ${
                  errors.full_name ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.full_name && <p id="register-fullName-error" className="text-red-700 text-xs mt-1">{errors.full_name}</p>}
            </div>

            <div>
              <label htmlFor="register-ssn" className="block text-sm font-medium text-gray-700 mb-2">Social Security Number</label>
              <div className="relative">
                <input
                  id="register-ssn"
                  type={showSSN ? 'text' : 'password'}
                  name="ssn"
                  value={formData.ssn}
                  onChange={handleChange}
                  placeholder="123-45-6789"
                  maxLength={11}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={errors.ssn ? 'true' : undefined}
                  aria-describedby={errors.ssn ? 'register-ssn-error' : undefined}
                  className={`w-full px-4 py-2 pr-16 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                    errors.ssn ? 'border-red-500' : 'border-gray-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSSN((prev) => !prev)}
                  aria-pressed={showSSN}
                  aria-controls="register-ssn"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  {showSSN ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.ssn && <p id="register-ssn-error" className="text-red-700 text-xs mt-1">{errors.ssn}</p>}
            </div>

            <div>
              <label htmlFor="register-dob" className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
              <input
                id="register-dob"
                type="date"
                name="dob"
                value={formData.dob}
                onChange={handleChange}
                autoComplete="bday"
                aria-required="true"
                aria-invalid={errors.dob ? 'true' : undefined}
                aria-describedby={errors.dob ? 'register-dob-error' : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent outline-none transition ${
                  errors.dob ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.dob && <p id="register-dob-error" className="text-red-700 text-xs mt-1">{errors.dob}</p>}
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                id="register-password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                autoComplete="new-password"
                aria-required="true"
                aria-invalid={errors.password ? 'true' : undefined}
                aria-describedby={errors.password ? 'register-password-error' : 'register-password-hint'}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent focus-within:ring-2 focus-within:ring-green-500 focus-within:border-transparent outline-none transition ${
                  errors.password ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.password ? (
                <p id="register-password-error" className="text-red-700 text-xs mt-1">{errors.password}</p>
              ) : (
                <p id="register-password-hint" className="text-gray-500 text-xs mt-1">Min 12 characters, 1 uppercase, 1 digit, 1 special character</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-700 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600 text-sm">
              Already have an account?{' '}
              <a href="/login" className="text-green-700 hover:text-green-800 font-semibold">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
