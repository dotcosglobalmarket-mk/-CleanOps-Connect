import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        register: resolve(__dirname, 'register.html'),
        login: resolve(__dirname, 'login.html'),
        forgotPassword: resolve(__dirname, 'forgot-password.html'),
        resetPassword: resolve(__dirname, 'reset-password.html'),
        verifyEmail: resolve(__dirname, 'verify-email.html'),
        customer: resolve(__dirname, 'customer.html'),
        cleaner: resolve(__dirname, 'cleaner.html'),
        admin: resolve(__dirname, 'admin.html'),
        ops: resolve(__dirname, 'ops.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        cookies: resolve(__dirname, 'cookies.html'),
        criminalDataPolicy: resolve(__dirname, 'criminal-data-policy.html'),
        leeds: resolve(__dirname, 'leeds.html'),
        bradford: resolve(__dirname, 'bradford.html'),
        wakefield: resolve(__dirname, 'wakefield.html'),
        areas: resolve(__dirname, 'areas.html'),
        southampton: resolve(__dirname, 'southampton.html'),
        nottingham: resolve(__dirname, 'nottingham.html'),
        liverpool: resolve(__dirname, 'liverpool.html'),
        manchester: resolve(__dirname, 'manchester.html'),
        london: resolve(__dirname, 'london.html'),
      },
    },
  },
});
