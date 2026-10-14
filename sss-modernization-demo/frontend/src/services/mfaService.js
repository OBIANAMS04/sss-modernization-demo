import api from './api';

// STORY-003: two-step verification with an authenticator app. The code check at sign-in is authService.verifyMfa.
export const mfaService = {
  // { mfaEnabled }
  status: async () => (await api.get('/mfa/status')).data,

  // Starts a setup; the response carries { secret, otpauthUrl, qrCode } and is the only time the key is sent
  startSetup: async () => (await api.post('/mfa/setup')).data,

  // Confirms the setup with a code from the app, which turns two-step verification on
  confirmSetup: async (totpCode) => (await api.post('/mfa/verify', { totpCode })).data,

  // Turning it off needs a current code
  disable: async (totpCode) => (await api.post('/mfa/disable', { totpCode })).data,
};
