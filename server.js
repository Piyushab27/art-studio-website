import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
createApp(openDb()).listen(port, () => console.log(`Art studio running at http://localhost:${port}`));
