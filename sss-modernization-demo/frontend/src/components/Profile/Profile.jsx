import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { profileService } from '../../services/profileService';
import { exemptionService } from '../../services/exemptionService';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const STATUS_STYLES = {
  Eligible: 'bg-green-100 text-green-800',
  'Pending Review': 'bg-yellow-100 text-yellow-800',
  'Not Eligible': 'bg-gray-100 text-gray-700',
  Ineligible: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[status] || STATUS_STYLES['Not Eligible']}`}>
      {status}
    </span>
  );
}

// GET /exemptions returns saved rows; POST /exemptions/check and profile saves return `evaluations`.
function toEligibility(data) {
  const items = data.evaluations || data.exemptions || [];
  return {
    eligible: items.some((e) => e.status !== 'Not Eligible'),
    determinedAt: data.determinedAt || null,
    items: items.map(({ exemptionType, label, status, reason }) => ({ exemptionType, label, status, reason })),
  };
}

function formFromProfile(profile) {
  return {
    phone: profile.phone || '',
    address: profile.address || '',
    annualIncome: profile.annualIncome ?? '',
    hasDocumentedHardship: !!profile.hasDocumentedHardship,
  };
}

export default function Profile() {
  const navigate = useNavigate();
  const userId = getUser()?.id;

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!userId) {
      navigate('/login');
      return;
    }
    Promise.all([profileService.getProfile(userId), exemptionService.getExemptions()])
      .then(([profileData, exemptionData]) => {
        setProfile(profileData);
        setForm(formFromProfile(profileData));
        setEligibility(exemptionData.total > 0 ? toEligibility(exemptionData) : null);
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load your profile.')))
      .finally(() => setLoading(false));
  }, [userId, navigate]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setNotice('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    const income = String(form.annualIncome).trim();
    if (income !== '' && !/^\d+$/.test(income)) {
      setError('Annual income must be a whole number of dollars (no commas or decimals).');
      return;
    }

    setSaving(true);
    try {
      const updated = await profileService.updateProfile(userId, {
        phone: form.phone.trim(),
        address: form.address.trim(),
        annualIncome: income === '' ? null : Number(income),
        hasDocumentedHardship: form.hasDocumentedHardship,
      });
      setProfile(updated);
      setForm(formFromProfile(updated));
      setEligibility(toEligibility(updated.eligibility));
      setNotice('Profile saved. Exemption eligibility was re-checked.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save your profile.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async () => {
    setError('');
    setNotice('');
    setChecking(true);
    try {
      setEligibility(toEligibility(await exemptionService.checkEligibility()));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not check eligibility.'));
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const inputClass =
    'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition';

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
              <p className="text-sm text-gray-600">Profile details and exemption eligibility</p>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/dashboard" className="text-blue-600 font-medium hover:text-blue-700">
                ← Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition duration-200"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
        )}
        {notice && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading your profile...</p>
          </div>
        ) : (
          form && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <section className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Profile Details</h2>
                    <p className="text-sm text-gray-600">{profile.fullName} · {profile.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Compliance</p>
                    <StatusBadge status={profile.complianceStatus} />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Compliance requires age 18 or older, a phone number, and an address.
                </p>

                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="555-0100" className={inputClass} />
                  </div>

                  <div>
                    <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                    <textarea id="address" name="address" rows={2} value={form.address} onChange={handleChange} maxLength={500} placeholder="1 Main St, Springfield" className={inputClass} />
                  </div>

                  <div>
                    <label htmlFor="annualIncome" className="block text-sm font-medium text-gray-700 mb-2">
                      Annual income (USD, optional)
                    </label>
                    <input id="annualIncome" name="annualIncome" type="text" inputMode="numeric" value={form.annualIncome} onChange={handleChange} placeholder="e.g. 18000" className={inputClass} />
                    <p className="text-xs text-gray-500 mt-1">Used for the income-based exemption (Type B). Leave blank if you prefer not to say.</p>
                  </div>

                  <label className="flex items-start gap-3">
                    <input name="hasDocumentedHardship" type="checkbox" checked={form.hasDocumentedHardship} onChange={handleChange} className="mt-1 h-4 w-4" />
                    <span className="text-sm text-gray-700">
                      I have a documented hardship
                      <span className="block text-xs text-gray-500">Hardship exemptions (Type C) are reviewed by a caseworker.</span>
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition duration-200"
                  >
                    {saving ? 'Saving...' : 'Save Profile'}
                  </button>
                </form>
              </section>

              <section className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Exemption Eligibility</h2>
                  <button
                    onClick={handleCheck}
                    disabled={checking}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition duration-200"
                  >
                    {checking ? 'Checking...' : 'Check Eligibility'}
                  </button>
                </div>

                {!eligibility ? (
                  <p className="text-gray-600">Not checked yet. Click "Check Eligibility" or save your profile.</p>
                ) : (
                  <>
                    <div className={`mb-4 p-4 rounded-lg border ${eligibility.eligible ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                      {eligibility.eligible ? (
                        <>
                          <p className="font-semibold text-green-800">Eligible for exemptions:</p>
                          <ul className="list-disc list-inside text-green-800 text-sm mt-1">
                            {eligibility.items.filter((e) => e.status !== 'Not Eligible').map((e) => (
                              <li key={e.exemptionType}>{e.label}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="font-semibold text-gray-800">Not eligible for any exemption</p>
                      )}
                    </div>

                    <ul className="space-y-3">
                      {eligibility.items.map((e) => (
                        <li key={e.exemptionType} className="border rounded-lg p-3">
                          <div className="flex justify-between items-center gap-2">
                            <p className="font-medium text-gray-900 text-sm">{e.label}</p>
                            <StatusBadge status={e.status} />
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{e.reason}</p>
                        </li>
                      ))}
                    </ul>

                    {eligibility.determinedAt && (
                      <p className="text-xs text-gray-500 mt-4">
                        Last checked {new Date(eligibility.determinedAt).toLocaleString()}
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          )
        )}
      </main>
    </div>
  );
}
