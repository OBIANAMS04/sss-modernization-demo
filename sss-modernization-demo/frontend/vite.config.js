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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
})
