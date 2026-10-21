import api from './api';

// STORY-003: two-step verification with an authenticator app. The code check at sign-in is authService.verifyMfa.
export const mfaService = {
  // { mfaEnabled, recoveryCodesLeft }
  status: async () => (await api.get('/mfa/status')).data,

  // Starts a setup; the response carries { secret, otpauthUrl, qrCode } and is the only time the key is sent
  startSetup: async () => (await api.post('/mfa/setup')).data,

  // Confirms the setup with a code from the app, which turns two-step verification on; returns { recoveryCodes } (STORY-041), shown once
  confirmSetup: async (totpCode) => (await api.post('/mfa/verify', { totpCode })).data,

  // STORY-041: new recovery codes after a current code; the old ones stop working. Returns { recoveryCodes }, shown once
  newRecoveryCodes: async (totpCode) => (await api.post('/mfa/recovery-codes', { totpCode })).data,

  // Turning it off needs a current code
  disable: async (totpCode) => (await api.post('/mfa/disable', { totpCode })).data,
};
