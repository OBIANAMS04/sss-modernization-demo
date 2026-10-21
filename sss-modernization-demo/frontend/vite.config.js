import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Emits dist/version.json with the commit Render built (RENDER_GIT_COMMIT), so a deploy can be
// verified from outside: https://sss-demo-frontend.onrender.com/version.json
function versionFile() {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(
          { commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7), builtAt: new Date().toISOString() },
          null,
          2
        ),
      })
    },
  }
}

// STORY-041: a content security policy for the built site. The site's host (a Render static site) sets headers only in its
// dashboard, so the policy travels in the page as a <meta> tag; it lets the page load only its own scripts and styles and talk only
// to its own API (the address it was built with), so injected script has nowhere to run or send data. The dev server is left alone
// (it injects inline styles). Framing protection (frame-ancestors) only works as a header: see docs/SECURITY-TESTING.md.
function contentSecurityPolicy() {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      const api = new URL(process.env.VITE_API_BASE_URL || 'http://localhost:3001/api').origin
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self' ${api}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile(), contentSecurityPolicy()],
})
