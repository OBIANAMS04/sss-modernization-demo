import api from './api';

// STORY-021 and 025: drift detection and fairness testing for the policy assistant. Case managers and admins read; only an administrator
// starts a run (it calls the model, so it costs money, and a kind of run can be started once an hour) or marks a baseline.
export const aiQualityService = {
  // Daily quality signals with their drift, change markers, open alerts, and the evaluation runs against the baseline.
  quality: async () => (await api.get('/ai-quality')).data,
  // The latest counterfactual run, decision outcomes by age band and region, and what the demo does not collect.
  fairness: async () => (await api.get('/ai-quality/fairness')).data,
  // Admin: runs the golden set on the server. Returns the run, still running; the page reads it again until it finishes.
  startEvaluation: async () => (await api.post('/ai-quality/evaluations')).data.run,
  // Admin: runs the counterfactual question set on the server.
  startFairnessRun: async () => (await api.post('/ai-quality/fairness-runs')).data.run,
  // Admin: the run later evaluations are compared with.
  markBaseline: async (id) => (await api.post(`/ai-quality/runs/${id}/baseline`)).data.run,
};
