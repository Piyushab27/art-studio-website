const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`Node ${process.versions.node} is too old. This app needs Node 22.5 or newer (it uses the built-in node:sqlite).`);
  process.exit(1);
}
const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

const port = Number(process.env.PORT) || 3000;
createApp(openDb()).listen(port, () => console.log(`Art studio running at http://localhost:${port}`));
