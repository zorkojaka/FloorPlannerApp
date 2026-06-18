import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base mora ustrezati imenu repozitorija za GitHub Pages projektno stran:
// https://zorkojaka.github.io/FloorPlannerApp/
export default defineConfig({
  base: '/FloorPlannerApp/',
  plugins: [react()],
});
