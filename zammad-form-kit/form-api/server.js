// ===== BEGIN FILE: zammad-form-kit/form-api/server.js =====
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

import {
  pickLangFromCountryAlpha3,
  buildConfirmationSubject,
  buildConfirmationEmailHtml,
} from './lib/email/confirmation.js';

// --- Liste pays FR
import countries from 'i18n-iso-countries';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const frLocale = require('i18n-iso-countries/langs/fr.json');
countries.registerLocale(frLocale);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- ENV
const ZAMMAD_URL = process.env.ZAMMAD_URL || 'http://zammad-nginx:8080';
const ZAMMAD_GROUP = process.env.ZAMMAD_GROUP || 'Declarations GNSS';
const ZAMMAD_TOKEN = process.env.ZAMMAD_TOKEN; // submit token (doit avoir ticket.agent)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());

const ZAMMAD_PUBLIC_URL = String(process.env.ZAMMAD_PUBLIC_URL || '').replace(/\/+$/, '');
const ZAMMAD_PASSWORD_RESET_URL = String(process.env.ZAMMAD_PASSWORD_RESET_URL || '').trim();
const HELPDESK_NAME = String(process.env.HELPDESK_NAME || 'Centipede-RTK Helpdesk').trim();

// --- Vérification unicité mount point (Grafana datasource)
// Par défaut, pointe vers l’API Grafana publique Centipede-RTK. Peut être surchargé via .env.form.
const GRAFANA_DS_QUERY_URL = String(
  process.env.GRAFANA_DS_QUERY_URL ||
    'https://gf.centipede-rtk.org/api/ds/query?ds_type=grafana-postgresql-datasource',
).trim();
const GRAFANA_ORG_ID = String(process.env.GRAFANA_ORG_ID || '7').trim();
const GRAFANA_DS_UID = String(process.env.GRAFANA_DS_UID || 'ef4dj94eoifpcf').trim();
const GRAFANA_DS_ID = Number(process.env.GRAFANA_DS_ID || 24);
const GRAFANA_TIMEOUT_MS = Number(process.env.GRAFANA_TIMEOUT_MS || 8000);
// Optionnel: authentification Grafana (ex: "Bearer <token>" ou "Token <token>")
const GRAFANA_AUTH_HEADER = String(process.env.GRAFANA_AUTH_HEADER || '').trim();
// Cache en mémoire (ms) pour limiter les appels Grafana
const MP_CACHE_TTL_MS = Number(process.env.MP_CACHE_TTL_MS || 300_000);

// Optionnel: désactiver l’envoi de mail (utile en dev)
const CONFIRM_EMAIL = String(process.env.CONFIRM_EMAIL || 'true').toLowerCase() === 'true';

// --- Inline logo + Terms (stockés dans le déploiement)
const HELPDESK_TERMS_URL = String(
  process.env.HELPDESK_TERMS_URL || 'https://www.centipede-rtk.org/terms-conditions',
).trim();

const HELPDESK_LOGO_FILE = String(
  process.env.HELPDESK_LOGO_FILE || 'assets/centipede-rtk-logo.png',
).trim();

function mimeFromFilename(filename) {
  const ext = String(filename).toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  // SVG possible, mais parfois filtré par certains clients mail
  if (ext === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function loadInlineLogoDataUri(filePath) {
  if (!filePath) return null;
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    const mime = mimeFromFilename(abs);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const HELPDESK_LOGO_SRC = loadInlineLogoDataUri(HELPDESK_LOGO_FILE);

// --- CORS
app.use(
  cors({
    origin: (origin, cb) => cb(null, CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)),
    credentials: false,
  }),
);

// --- Zammad client
const zammad = axios.create({
  baseURL: `${ZAMMAD_URL}/api/v1`,
  headers: {
    Authorization: `Token token=${ZAMMAD_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 60_000,
});

// --- santé
app.get(['/api/health', '/health'], (_req, res) => res.json({ ok: true }));

// --- pays
app.get(['/api/countries', '/countries'], (_req, res) => {
  const namesFr = countries.getNames('fr');
  const list = Object.entries(namesFr)
    .map(([a2, name]) => {
      const a3 = countries.alpha2ToAlpha3(a2);
      return a3 ? { code: a3, name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  res.json(list);
});

// --- helpers
function isEmail(s) {
  const v = String(s || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function hasMin8Decimals(s) {
  return typeof s === 'string' && /^-?\d+\.\d{8,}$/.test(s);
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function fmt(v, n = 3) {
  const x = Number(v);
  return Number.isFinite(x) ? x.toFixed(n) : String(v || '');
}

// --- Mount point uniqueness: Grafana-backed check (with in-memory cache)
const mpCheckCache = new Map(); // mp -> { is_taken: boolean, expiresAt: number }

function assertMountPoint(mp) {
  const v = String(mp || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(v)) {
    const e = new Error('Mount point invalide (2 à 10 caractères, uniquement A–Z et 0–9).');
    e.status = 422;
    throw e;
  }
  return v;
}

function grafanaTableHasRows(payload) {
  const frame = payload?.results?.A?.frames?.[0];
  const values = frame?.data?.values;
  // Grafana "table": values = [col1Rows[], col2Rows[], ...]
  const firstCol = Array.isArray(values) ? values[0] : null;
  return Array.isArray(firstCol) && firstCol.length > 0;
}

async function queryGrafana(rawSql) {
  if (!GRAFANA_DS_QUERY_URL) {
    const e = new Error('GRAFANA_DS_QUERY_URL manquant côté serveur.');
    e.status = 500;
    throw e;
  }

  const now = Date.now();
  const payload = {
    queries: [
      {
        refId: 'A',
        datasource: { type: 'grafana-postgresql-datasource', uid: GRAFANA_DS_UID },
        rawSql,
        format: 'table',
        datasourceId: GRAFANA_DS_ID,
        intervalMs: 60000,
        maxDataPoints: 1,
      },
    ],
    from: String(now - 60_000),
    to: String(now),
  };

  let r;
  try {
    r = await axios.post(GRAFANA_DS_QUERY_URL, payload, {
      timeout: GRAFANA_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Grafana-Org-Id': GRAFANA_ORG_ID,
        ...(GRAFANA_AUTH_HEADER ? { Authorization: GRAFANA_AUTH_HEADER } : {}),
      },
      // Ne pas laisser Axios lever une exception sur les codes HTTP: on gère nous-mêmes.
      validateStatus: () => true,
    });
  } catch (err) {
    const e = new Error('Impossible de joindre Grafana pour vérifier les mount points.');
    e.status = 503;
    throw e;
  }

  if (r.status !== 200) {
    const msg = r.data?.message || r.data?.error || `Grafana HTTP ${r.status}`;
    const e = new Error(msg);
    e.status = 503;
    throw e;
  }

  return r.data;
}

async function isMountPointTaken(mp) {
  const v = assertMountPoint(mp);

  const cached = mpCheckCache.get(v);
  if (cached && cached.expiresAt > Date.now()) return cached.is_taken;

  // SAFE: v est strictement [A-Z0-9]{2,10}, pas d'injection SQL possible ici.
  const rawSql = `SELECT 1 AS "x" FROM grafpub.antenne_mp WHERE mp = '${v}' LIMIT 1;`;
  const data = await queryGrafana(rawSql);
  const taken = grafanaTableHasRows(data);

  mpCheckCache.set(v, { is_taken: taken, expiresAt: Date.now() + MP_CACHE_TTL_MS });
  return taken;
}

// --- API: check mount point uniqueness
app.get('/api/mountpoints/check', async (req, res) => {
  try {
    const mp = assertMountPoint(req.query.mp);
    const taken = await isMountPointTaken(mp);
    res.json({ ok: true, mp, is_taken: taken });
  } catch (e) {
    const status = e?.status || 422;
    res.status(status).json({ ok: false, message: e?.message || 'Erreur.' });
  }
});

function validatePayload(f) {
  const email = String(f.email || '').trim();
  if (!isEmail(email)) throw new Error('Email manquant/incorrect.');

  const contactName = String(f.contact_name || '').trim();
  if (!contactName) throw new Error('Nom complet manquant.');

  const mp = String(f.mount_point || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(mp)) {
    throw new Error('Mount point invalide (2 à 10 caractères, uniquement A–Z et 0–9).');
  }

  if (!/^[A-Z]{3}$/.test(String(f.country_alpha3 || ''))) {
    throw new Error('Code pays ISO alpha-3 manquant/incorrect.');
  }

  if (!String(f.receiver || '').trim()) throw new Error('Récepteur manquant.');
  if (!String(f.antenna || '').trim()) throw new Error('Antenne manquante.');

  const lat = toNumber(f.latitude);
  const lng = toNumber(f.longitude);
  if (!hasMin8Decimals(String(f.latitude)) || lat < -90 || lat > 90) {
    throw new Error('Latitude invalide (>= 8 décimales, -90..90).');
  }
  if (!hasMin8Decimals(String(f.longitude)) || lng < -180 || lng > 180) {
    throw new Error('Longitude invalide (>= 8 décimales, -180..180).');
  }

  const elv = toNumber(f.elevation_m);
  if (!Number.isFinite(elv)) throw new Error('Élévation manquante/incorrecte (m).');

  const e_n = toNumber(f.e_n);
  const e_e = toNumber(f.e_e);
  const e_h = toNumber(f.e_h);
  if (!Number.isFinite(e_n)) throw new Error('E_N manquant/incorrect (mm).');
  if (!Number.isFinite(e_e)) throw new Error('E_E manquant/incorrect (mm).');
  if (!Number.isFinite(e_h)) throw new Error('E_H manquant/incorrect (mm).');
  if (!(e_n <= 10)) throw new Error('E_N doit être ≤ 10 mm.');
  if (!(e_e <= 10)) throw new Error('E_E doit être ≤ 10 mm.');
  if (!(e_h <= 20)) throw new Error('E_H doit être ≤ 20 mm.');
}

// --- Soumission publique : crée le ticket via token (customer auto-créé via guess:email)
// puis envoie un email de confirmation au déclarant (article type=email).
app.post('/api/submit', upload.any(), async (req, res) => {
  try {
    if (!ZAMMAD_TOKEN) {
      return res.status(500).json({ ok: false, detail: { message: 'ZAMMAD_TOKEN manquant côté serveur.' } });
    }

    const fields = { ...req.body };
    // Normalisation côté serveur (défense en profondeur)
    fields.mount_point = String(fields.mount_point || '').trim().toUpperCase();


    if (!fields.confirm_map) {
      return res.status(422).json({ ok: false, detail: { message: 'Confirmation carte requise.' } });
    }

    try {
      validatePayload(fields);
    } catch (e) {
      return res.status(422).json({ ok: false, detail: { message: e.message } });
    }

    // --- Unicité mount point (bloquant)
    try {
      const taken = await isMountPointTaken(fields.mount_point);
      if (taken) {
        return res
          .status(422)
          .json({ ok: false, detail: { message: 'Mount point déjà utilisé. Choisissez-en un autre.' } });
      }
    } catch (e) {
      const status = e?.status || 503;
      return res.status(status).json({
        ok: false,
        detail: { message: "Impossible de vérifier si le mount point est déjà utilisé. Réessayez plus tard." },
      });
    }

    const customerEmail = String(fields.email || '').trim();
    const contactName = String(fields.contact_name || '').trim();
    const mountPoint = String(fields.mount_point || '').trim();

    const subject = `Déclaration GNSS ${mountPoint} — ${new Date().toISOString().slice(0, 10)}`;

    const summaryLines = [
      'Déclaration base GNSS',
      `Déclarant : ${contactName || '-'} <${customerEmail}>` + (fields.profession ? ` — ${fields.profession}` : ''),
      `Position : lat ${fmt(fields.latitude, 8)} ; lon ${fmt(fields.longitude, 8)} ; élévation ${fmt(fields.elevation_m)} m`,
      `Qualité (mm) : E_N ${fields.e_n} ; E_E ${fields.e_e} ; E_H ${fields.e_h}`,
      `Base : MP ${mountPoint || '-'} ; Pays ${fields.country_alpha3 || '-'}`,
      `Matériel : Récepteur ${fields.receiver || '-'} ; Antenne ${fields.antenna || '-'}`,
      fields.epoch ? `Époque : ${fields.epoch}` : null,
      fields.notes ? `Notes : ${fields.notes}` : null,
    ].filter(Boolean);
    const summaryBody = summaryLines.join('\n');

    // Pousser les champs custom du formulaire (créés via bootstrap.sh)
    const reserved = new Set(['confirm_map']);
    const ticketPayload = {
      title: subject,
      group: ZAMMAD_GROUP,
      customer_id: `guess:${customerEmail}`,
      article: {
        subject,
        body: summaryBody,
        content_type: 'text/plain',
        type: 'web',
        internal: false,
      },
    };

    for (const [k, v] of Object.entries(fields)) {
      if (reserved.has(k)) continue;
      if (v === undefined || v === null || String(v).trim() === '') continue;
      ticketPayload[k] = v;
    }

    const t = await zammad.post('/tickets', ticketPayload).then((r) => r.data);

    // Pièces jointes -> article "note"
    if (req.files?.length) {
      const attachments = req.files.map((f) => ({
        filename: f.originalname,
        'mime-type': f.mimetype || 'application/octet-stream',
        data: f.buffer.toString('base64'),
      }));

      await zammad.post('/ticket_articles', {
        ticket_id: t.id,
        subject: 'Pièces jointes (formulaire)',
        body: 'Voir les fichiers ci-joints.',
        content_type: 'text/plain',
        type: 'note',
        internal: false,
        attachments,
        sender: 'Agent',
      });
    }

    // --- Email confirmation
    let email_status = 'skipped'; // 'sent' | 'pending' | 'failed' | 'skipped'

    if (CONFIRM_EMAIL) {
      const countryAlpha3 = String(fields.country_alpha3 || '').trim().toUpperCase();
      const lang = pickLangFromCountryAlpha3(countryAlpha3);

      const confirmSubject = buildConfirmationSubject({
        lang,
        ticketNumber: t.number,
        mountPoint,
      });

      const ticketUrl = ZAMMAD_PUBLIC_URL ? `${ZAMMAD_PUBLIC_URL}/#ticket/zoom/${t.id}` : null;

      // IMPORTANT: ne jamais tomber sur un lien interne (localhost / zammad-nginx)
      const passwordResetUrl =
        (ZAMMAD_PASSWORD_RESET_URL && ZAMMAD_PASSWORD_RESET_URL.replace(/\/+$/, '')) ||
        (ZAMMAD_PUBLIC_URL ? `${ZAMMAD_PUBLIC_URL}/#password_reset` : null);

      const confirmBodyHtml = buildConfirmationEmailHtml({
        lang,
        helpdeskName: HELPDESK_NAME,
        logoSrc: HELPDESK_LOGO_SRC,
        termsUrl: HELPDESK_TERMS_URL,
        contactName,
        customerEmail,
        ticketNumber: t.number,
        mountPoint,
        ticketUrl,
        passwordResetUrl,
      });

      try {
        // Timeout plus large uniquement pour l'envoi (évite faux négatifs)
        await zammad.post(
          '/ticket_articles',
          {
            ticket_id: t.id,
            to: customerEmail,
            subject: confirmSubject,
            body: confirmBodyHtml,
            content_type: 'text/html',
            type: 'email',
            internal: false,
            sender: 'Agent',
          },
          { timeout: 180_000 }, // 3 minutes
        );

        email_status = 'sent';
      } catch (e) {
        // Si timeout / souci réseau, Zammad a pu traiter quand même -> statut "pending"
        const isNetworkOrTimeout =
          !e?.response ||
          e?.code === 'ECONNABORTED' ||
          String(e?.message || '').toLowerCase().includes('timeout');

        email_status = isNetworkOrTimeout ? 'pending' : 'failed';

        console.error('CONFIRM EMAIL ERROR:', {
          code: e?.code,
          status: e?.response?.status,
          data: e?.response?.data,
          message: e?.message,
        });
      }
    }

    res.json({ ok: true, ticket_id: t.id, number: t.number, email_status });
  } catch (err) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || { message: err.message };
    res.status(status).json({ ok: false, detail });
  }
});

app.listen(3000, () => console.log('Form API listening on :3000'));
// ===== END FILE: zammad-form-kit/form-api/server.js =====

