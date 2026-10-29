const { handler } = require('../api-handler.cjs');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('auven_path');
  if (!route || !/^[a-zA-Z0-9/_-]+$/.test(route)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  url.searchParams.delete('auven_path');
  req.url = '/api/' + route + url.search;
  return handler(req, res);
};
