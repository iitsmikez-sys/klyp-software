const fs = require('node:fs');
const path = require('node:path');

/** React 19 no longer ships UMD bundles; mount its development CJS modules in the fixture page. */
module.exports = async function loadReactBrowser(page) {
  const root = path.resolve(__dirname, '..', '..', 'node_modules');
  const sources = {
    react: fs.readFileSync(path.join(root, 'react/cjs/react.development.js'), 'utf8'),
    scheduler: fs.readFileSync(path.join(root, 'scheduler/cjs/scheduler.development.js'), 'utf8'),
    'react-dom': fs.readFileSync(path.join(root, 'react-dom/cjs/react-dom.development.js'), 'utf8'),
    'react-dom/client': fs.readFileSync(path.join(root, 'react-dom/cjs/react-dom-client.development.js'), 'utf8'),
  };
  await page.evaluate(modules => {
    const cache = {};
    const load = name => {
      if (cache[name]) return cache[name];
      const module = { exports: {} };
      cache[name] = module.exports;
      new Function('require', 'module', 'exports', 'process', modules[name])(
        load, module, module.exports, { env: { NODE_ENV: 'development' } });
      return cache[name] = module.exports;
    };
    window.React = load('react');
    window.ReactDOM = load('react-dom/client');
  }, sources);
};
