import { defineConfig } from 'vite';

// Keep in sync with DEFAULT_PORT in shared/src/constants.ts.
const GAME_SERVER = 'http://localhost:3000';

export default defineConfig({
  server: {
    port: 5173,
    // The client always connects to its own origin; in dev, Vite forwards that to the game server.
    proxy: {
      '/socket.io': { target: GAME_SERVER, ws: true },
      '/api': { target: GAME_SERVER },
    },
  },
  build: {
    target: 'es2022',
    // three.js alone is ~700 kB minified; that's expected for a 3D game.
    chunkSizeWarningLimit: 1200,
  },
});
