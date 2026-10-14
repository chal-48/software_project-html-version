const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
// Copy only browser assets. Never copy backend code, .env, or Git metadata.
const browserFile = /\.(html|css|js|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)$/i;
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile() && browserFile.test(entry.name)) fs.copyFileSync(from, to);
  }
}
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && browserFile.test(entry.name)) fs.copyFileSync(path.join(root, entry.name), path.join(output, entry.name));
}
for (const directory of ['admin', 'driver', 'assets']) {
  copyDirectory(path.join(root, directory), path.join(output, directory));
}
console.log('Frontend copied to public/');
