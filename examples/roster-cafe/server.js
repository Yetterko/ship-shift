import { createApp } from './src/app.js';

const port = Number(process.env.PORT || 4620);
createApp().listen(port, '127.0.0.1', () => console.log(`Roster at http://127.0.0.1:${port}`));
