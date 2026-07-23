const dns = require('node:dns').promises;
const net = require('node:net');

function normalizePublicHttpsUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('INVALID_URL');
  const parsed = new URL(input.trim());
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('INVALID_URL');
  }
  parsed.hash = '';
  return parsed.toString();
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIp(address) {
  const raw = String(address || '').toLowerCase().split('%')[0];
  const kind = net.isIP(raw);
  const normalized = kind === 6
    ? new URL(`http://[${raw}]/`).hostname.replace(/^\[|\]$/g, '')
    : raw;
  if (kind === 4) return isPrivateIpv4(normalized);
  if (kind !== 6) return true;
  if (normalized.startsWith('::') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('fec') || normalized.startsWith('fed') || normalized.startsWith('fee') || normalized.startsWith('fef')) return true;
  if (normalized.startsWith('ff') || normalized.startsWith('64:ff9b:') || normalized.startsWith('2002:')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice(7));
  return normalized.startsWith('2001:db8:');
}

function blockedHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return value === 'localhost'
    || value.endsWith('.localhost')
    || value.endsWith('.local')
    || value.endsWith('.internal');
}

function createPublicUrlGuard({ resolver = dns.lookup, timeoutMs = 3000, cacheTtlMs = 60 * 1000 } = {}) {
  const hostCache = new Map();

  async function resolvePublicHost(hostname) {
    if (blockedHostname(hostname) || (net.isIP(hostname) && isPrivateIp(hostname))) throw new Error('PRIVATE_HOST');
    const cached = hostCache.get(hostname);
    if (!cached || cached.expiresAt <= Date.now()) {
      if (!cached && hostCache.size >= 512) hostCache.delete(hostCache.keys().next().value);
      const lookup = Promise.resolve(resolver(hostname, { all: true, verbatim: true }))
        .then((addresses) => {
          const list = Array.isArray(addresses) ? addresses : [addresses];
          if (!list.length || list.some((entry) => isPrivateIp(entry && entry.address))) throw new Error('PRIVATE_HOST');
          return list.map((entry) => ({
            address: entry.address,
            family: Number(entry.family) || net.isIP(entry.address)
          }));
        });
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs));
      const promise = Promise.race([lookup, timeout]).catch((error) => {
        hostCache.delete(hostname);
        throw error;
      });
      hostCache.set(hostname, { promise, expiresAt: Date.now() + cacheTtlMs });
    }
    return hostCache.get(hostname).promise;
  }

  async function assertPublicUrl(input) {
    const normalized = normalizePublicHttpsUrl(input);
    await resolvePublicHost(new URL(normalized).hostname);
    return normalized;
  }

  async function allowBrowserRequest(input) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
      await assertPublicUrl(input);
      return true;
    } catch (error) {
      return false;
    }
  }

  return { resolvePublicHost, assertPublicUrl, allowBrowserRequest };
}

module.exports = { normalizePublicHttpsUrl, isPrivateIp, createPublicUrlGuard };
