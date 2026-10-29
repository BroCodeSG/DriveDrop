/**
 * Static username + PIN from Script Properties (DASH_USERNAME, DASH_PIN).
 * Sessions are random tokens held in the script cache with a sliding TTL.
 */
const Auth = {
  SESSION_TTL_SECONDS: 2 * 60 * 60,
  MAX_FAILS: 5,
  LOCK_SECONDS: 15 * 60,
  FAILS_KEY: 'LOGIN_FAILS',

  login(username, pin) {
    const expectedUser = Config.secret('DASH_USERNAME');
    const expectedPin = Config.secret('DASH_PIN');
    if (!expectedUser || !expectedPin) {
      throw new Error('Login is not configured. Set DASH_USERNAME and DASH_PIN in Script Properties.');
    }

    const cache = CacheService.getScriptCache();
    const fails = Number(cache.get(this.FAILS_KEY) || 0);
    if (fails >= this.MAX_FAILS) {
      AppLog.warn('login_locked', { fails: fails });
      throw new Error('Too many failed attempts. Try again in 15 minutes.');
    }

    const userOk = this.safeEquals_(String(username || '').trim().toLowerCase(), expectedUser.trim().toLowerCase());
    const pinOk = this.safeEquals_(String(pin || ''), expectedPin);
    if (!userOk || !pinOk) {
      cache.put(this.FAILS_KEY, String(fails + 1), this.LOCK_SECONDS);
      AppLog.warn('login_failed', { fails: fails + 1 });
      Utilities.sleep(1000);
      throw new Error('Invalid username or PIN');
    }

    cache.remove(this.FAILS_KEY);
    const token = Utilities.getUuid() + Utilities.getUuid();
    cache.put('SESSION_' + token, '1', this.SESSION_TTL_SECONDS);
    return token;
  },

  check(token) {
    if (!token || typeof token !== 'string') return false;
    const cache = CacheService.getScriptCache();
    const key = 'SESSION_' + token;
    if (!cache.get(key)) return false;
    cache.put(key, '1', this.SESSION_TTL_SECONDS);
    return true;
  },

  logout(token) {
    if (token) CacheService.getScriptCache().remove('SESSION_' + token);
  },

  safeEquals_(a, b) {
    let diff = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  },
};
