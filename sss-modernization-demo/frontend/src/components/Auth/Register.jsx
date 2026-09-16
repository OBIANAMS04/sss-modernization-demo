import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { setToken, setUser } from '../../utils/tokenManager';
import { validateEmail, validatePassword, validateFullName, validateSSN, formatSSN, validateDateOfBirth } from '../../utils/validators';

export default function Register() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    ssn: '',
    dob: ''
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
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
      setErrors({ submit: err.response?.data?.message || 'Registration failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">SSS Platform</h1>
          <p className="text-gray-600 text-center mb-6">Create your account</p>

          {errors.submit && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {errors.submit}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                  errors.email ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
              <input
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                placeholder="John Doe"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                  errors.full_name ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.full_name && <p className="text-red-500 text-xs mt-1">{errors.full_name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Social Security Number</label>
              <input
                type="text"
                name="ssn"
                value={formData.ssn}
                onChange={handleChange}
                placeholder="123-45-6789"
                maxLength={11}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                  errors.ssn ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.ssn && <p className="text-red-500 text-xs mt-1">{errors.ssn}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date of Birth</label>
              <input
                type="date"
                name="dob"
                value={formData.dob}
                onChange={handleChange}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                  errors.dob ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.dob && <p className="text-red-500 text-xs mt-1">{errors.dob}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition ${
                  errors.password ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.password ? (
                <p className="text-red-500 text-xs mt-1">{errors.password}</p>
              ) : (
                <p className="text-gray-500 text-xs mt-1">Min 12 characters, 1 uppercase, 1 digit, 1 special character</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-600 text-sm">
              Already have an account?{' '}
              <a href="/login" className="text-green-600 hover:text-green-700 font-semibold">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
