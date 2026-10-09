CHALLENGE_JS = r"""() => {
  const title = document.title || '';
  const body = document.body ? document.body.innerText.slice(0, 3000) : '';
  if (document.querySelector('#challenge-form, #cf-challenge-running, [name="cf-turnstile-response"], .cf-turnstile') || /just a moment|bir dakika|attention required/i.test(title)) return 'cloudflare';
  if (document.querySelector('form[action*="validateCaptcha"]') || /robot check|captcha/i.test(title)) return 'captcha';
  if (/alışverişe devam etmek için/i.test(body)) return 'amazon_ara_sayfa';
  if (/access denied|erişim engellendi/i.test(title)) return 'erisim_engeli';
  if (/captcha|güvenlik doğrulaması|olağan dışı trafik|unusual traffic/i.test(body)) return 'captcha';
  return null;
}"""

JSONLD_NODES_JS = r"""() => {
  const nodes = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node['@type']) nodes.push(node);
    if (node['@graph']) walk(node['@graph']);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try { walk(JSON.parse(script.textContent)); } catch (error) { return; }
  });
  return nodes;
}"""


def with_helpers(script):
    return script.replace("__CHALLENGE__", CHALLENGE_JS).replace("__JSONLD__", JSONLD_NODES_JS)


def ready_js(data_ready):
    return with_helpers("() => (" + data_ready + ") || (__CHALLENGE__)() !== null")
