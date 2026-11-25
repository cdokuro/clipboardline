'use strict';
// Lightweight cross-platform (Linux + Windows) GitHub version checker for cdokuro/clipboardline.
// Checks GitHub Releases latest tag and falls back to linux/package.json on feat/linux-support.

const https = require('node:https');

const REPO = 'cdokuro/clipboardline';
const BRANCH = 'feat/linux-support';
const RELEASES_URL = `https://github.com/${REPO}/tree/${BRANCH}`;
const API_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const RAW_PKG = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/linux/package.json`;

function parseSemver(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(remote, local) {
  const r = parseSemver(remote);
  const l = parseSemver(local);
  if (!r || !l) return false;
  for (let i = 0; i < 3; i++) {
    if (r[i] !== l[i]) return r[i] > l[i];
  }
  return false;
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'ClipBoardLine-Updater',
          Accept: 'application/vnd.github+json, application/json',
        },
        timeout: timeoutMs,
      },
      res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
          if (body.length > 512 * 1024) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

class GitHubUpdates {
  constructor({ currentVersion, changed = () => {}, available = () => {} }) {
    this.currentVersion = String(currentVersion || '0.0.0');
    this.changed = changed;
    this.available = available;
    this._notifiedVersion = null;
    this.state = {
      status: 'idle',
      supported: true,
      githubChannel: true,
      busy: false,
      canInstall: false,
      availableVersion: null,
      version: this.currentVersion,
      releaseUrl: RELEASES_URL,
      message: '',
      checkedAt: null,
      error: null,
    };
  }

  get manifest() {
    return this.state.availableVersion
      ? { version: this.state.availableVersion, url: this.state.releaseUrl }
      : null;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    try { this.changed(this.state); } catch {}
  }

  async check({ silent = false } = {}) {
    if (this.state.busy) return this.state;
    this.set({ busy: true, status: 'checking', error: null, message: 'GitHub üzerinden yeni sürüm kontrol ediliyor…' });
    try {
      let remoteVersion = null;
      let releaseUrl = RELEASES_URL;
      try {
        const rel = await fetchJson(API_RELEASE);
        const tag = String(rel?.tag_name || '').replace(/^v/i, '').trim();
        if (parseSemver(tag)) {
          remoteVersion = tag;
          if (rel?.html_url) releaseUrl = rel.html_url;
        }
      } catch {}

      try {
        const pkg = await fetchJson(RAW_PKG);
        const pkgVer = String(pkg?.version || '').trim();
        if (parseSemver(pkgVer) && (!remoteVersion || isNewer(pkgVer, remoteVersion))) {
          remoteVersion = pkgVer;
          releaseUrl = RELEASES_URL;
        }
      } catch {}

      const now = Date.now();
      if (remoteVersion && isNewer(remoteVersion, this.currentVersion)) {
        this.set({
          busy: false,
          status: 'available',
          availableVersion: remoteVersion,
          releaseUrl,
          checkedAt: now,
          error: null,
          message: `Yeni sürüm mevcut: v${remoteVersion} (mevcut: v${this.currentVersion})`,
        });
        if (this._notifiedVersion !== remoteVersion) {
          this._notifiedVersion = remoteVersion;
          try { this.available({ version: remoteVersion, url: releaseUrl }); } catch {}
        }
      } else {
        this.set({
          busy: false,
          status: 'up-to-date',
          availableVersion: null,
          releaseUrl,
          checkedAt: now,
          error: null,
          message: `Güncelsin (v${this.currentVersion}).`,
        });
      }
    } catch (err) {
      this.set({
        busy: false,
        status: 'error',
        error: silent ? null : String(err?.message || err),
        message: silent ? '' : 'GitHub sürüm kontrolü başarısız oldu.',
      });
    }
    return this.state;
  }
}

module.exports = { GitHubUpdates, parseSemver, isNewer, RELEASES_URL };
