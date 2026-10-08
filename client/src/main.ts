import '@fontsource/lilita-one/latin-400.css';
import './style.css';
import { App } from './app/App';

const app = new App();
void app.start();

// Handy for poking at the game from the browser console while developing.
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
