import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services/authService';
import { setToken, setUser } from '../../utils/tokenManager';
import { validateEmail, validatePassword } from '../../utils/validators';
import { getApiErrorMessage } from '../../utils/apiError';
import usePageTitle from '../../utils/usePageTitle';

// Input ids in form order, so a failed submit can move focus to the first invalid field
const FIELD_IDS = { email: 'login-email', password: 'login-password' };

export default function Login() {
  usePageTitle('Sign in');
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionEnded = searchParams.get('expired') === '1'; // SessionTimer sends people here when their session ran out

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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
      newErrors.password = 'Password must be at least 6 characters';
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
      const response = await authService.login(formData.email, formData.password);
      setToken(response.token);
      setUser(response.user);
      navigate('/dashboard');
    } catch (err) {
      setErrors({ submit: getApiErrorMessage(err, 'Login failed') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main" className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">SSS Platform</h1>
          <p className="text-gray-600 text-center mb-6">Welcome back</p>

          {sessionEnded && (
            <div role="status" className="mb-4 p-4 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-sm">
              Your session ended. Please sign in again.
            </div>
          )}

          {errors.submit && (
            <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <input
                id="login-email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                aria-required="true"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
                  errors.email ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.email && <p id="login-email-error" className="text-red-700 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                autoComplete="current-password"
                aria-required="true"
                aria-invalid={errors.password ? 'true' : undefined}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
                  errors.password ? 'border-red-500' : 'border-gray-500'
                }`}
              />
              {errors.password && <p id="login-password-error" className="text-red-700 text-xs mt-1">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600 text-sm">
              Don't have an account?{' '}
              <a href="/register" className="text-blue-600 hover:text-blue-700 font-semibold">
                Create one
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
