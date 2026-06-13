import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        signup: resolve(__dirname, 'signup.html'),
        'confirm-account': resolve(__dirname, 'confirm-account.html'),
        'forgot-password': resolve(__dirname, 'forgot-password.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        groups: resolve(__dirname, 'groups.html'),
        invite: resolve(__dirname, 'invite.html'),
        guest: resolve(__dirname, 'guest.html'),
        'update-password': resolve(__dirname, 'update-password.html'),
        about: resolve(__dirname, 'about.html'),
        help: resolve(__dirname, 'help.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
