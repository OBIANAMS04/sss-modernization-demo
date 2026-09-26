// Backend error responses are shaped { error: { message, code } } (see
// backend/src/middleware/errorHandler.ts), not { message }. Reading
// err.response.data.message directly always returns undefined, which is
// why every failure used to show a generic fallback instead of the real
// reason (e.g. "Email already registered").
export function getApiErrorMessage(err, fallback) {
  return err.response?.data?.error?.message || fallback;
}
