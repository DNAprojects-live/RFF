// npm i express express-session
// node server.js   (Node 18+)
// Положи свой index.html в папку ./public/
import express from 'express';
import session from 'express-session';
import crypto from 'crypto';

const {
  DISCORD_ID, DISCORD_SECRET,
  ROBLOX_ID, ROBLOX_SECRET,
  BASE_URL,            // например https://rff.example.com (без / в конце)
  SESSION_SECRET,
  DISCORD_BOT_TOKEN, GUILD_ID, VERIFIED_ROLE_ID, // опционально: роли и ник
  PORT = 3000,
} = process.env;

const MODE = ROBLOX_ID ? 'oauth' : 'code'; // no Roblox app -> verify by profile code
const app = express();
app.use(express.json());
app.set('trust proxy', 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 30 * 864e5 },
}));
app.get('/me', (req, res) => res.sendFile('index.html', { root: 'public' }));
app.use(express.static('public'));

const b64url = (b) => b.toString('base64url');
const form = (o) => new URLSearchParams(o).toString();

// ---------- то, что дергает фронтенд ----------
app.get('/api/me', (req, res) => {
  const { discord = null, roblox = null } = req.session;
  res.json({
    discord: discord && { n: discord.n, h: discord.h, a: discord.a },
    roblox: roblox && roblox.name,
    robloxAvatar: roblox && roblox.avatar,
    robloxMode: MODE,
  });
});

app.get('/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ---------- Discord ----------
app.get('/auth/discord', (req, res) => {
  const state = (req.session.dstate = b64url(crypto.randomBytes(16)));
  res.redirect('https://discord.com/oauth2/authorize?' + form({
    client_id: DISCORD_ID, response_type: 'code', scope: 'identify',
    redirect_uri: `${BASE_URL}/auth/discord/callback`, state, prompt: 'none',
  }));
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.session.dstate) return res.status(400).send('Bad state');
    const t = await (await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: DISCORD_ID, client_secret: DISCORD_SECRET, grant_type: 'authorization_code',
        code, redirect_uri: `${BASE_URL}/auth/discord/callback`,
      }),
    })).json();
    const u = await (await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    const a = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
    req.session.discord = { id: u.id, n: u.global_name || u.username, h: u.username, a };
    res.redirect('/me');
  } catch (e) { console.error(e); res.status(500).send('Discord login failed'); }
});

// ---------- Roblox (OAuth 2.0 + PKCE) ----------
app.get('/auth/roblox', (req, res) => {
  if (!req.session.discord) return res.redirect('/');
  const state = (req.session.rstate = b64url(crypto.randomBytes(16)));
  const verifier = (req.session.rverifier = b64url(crypto.randomBytes(32)));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  res.redirect('https://apis.roblox.com/oauth/v1/authorize?' + form({
    client_id: ROBLOX_ID, response_type: 'code', scope: 'openid profile',
    redirect_uri: `${BASE_URL}/auth/roblox/callback`, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  }));
});

app.get('/auth/roblox/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.session.rstate) return res.status(400).send('Bad state');
    const t = await (await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: ROBLOX_ID, client_secret: ROBLOX_SECRET, grant_type: 'authorization_code',
        code, redirect_uri: `${BASE_URL}/auth/roblox/callback`, code_verifier: req.session.rverifier,
      }),
    })).json();
    const u = await (await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    const th = await (await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${u.sub}&size=150x150&format=Png&isCircular=false`
    )).json();
    req.session.roblox = { id: u.sub, name: u.preferred_username || u.name, avatar: th?.data?.[0]?.imageUrl || null };

    // TODO: сохрани пару discord.id <-> roblox.id в свою БД (иначе привязка живёт только в сессии)
    await giveDiscordPerks(req.session.discord.id, req.session.roblox.name);
    res.redirect('/me');
  } catch (e) { console.error(e); res.status(500).send('Roblox login failed'); }
});


// ---------- Roblox without an app: code in profile description ----------
async function robloxAvatar(id) {
  try {
    const th = await (await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`
    )).json();
    return th?.data?.[0]?.imageUrl || null;
  } catch { return null; }
}

app.post('/auth/roblox-code/start', async (req, res) => {
  try {
    if (!req.session.discord) return res.status(401).json({ error: 'Log in with Discord first' });
    const username = String(req.body.username || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Invalid Roblox username' });
    const r = await (await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    })).json();
    const u = r?.data?.[0];
    if (!u) return res.status(404).json({ error: 'Roblox user not found' });
    const code = 'RFF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    req.session.rpending = { id: String(u.id), name: u.name, code, exp: Date.now() + 10 * 60 * 1000 };
    res.json({ code, name: u.name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Roblox is not responding, try again' }); }
});

app.post('/auth/roblox-code/check', async (req, res) => {
  try {
    const p = req.session.rpending;
    if (!req.session.discord || !p || Date.now() > p.exp) return res.status(400).json({ error: 'Code expired, start again' });
    const prof = await (await fetch(`https://users.roblox.com/v1/users/${p.id}`)).json();
    if (!(prof.description || '').includes(p.code))
      return res.status(400).json({ error: 'Code not found in your profile About section yet' });
    req.session.roblox = { id: p.id, name: p.name, avatar: await robloxAvatar(p.id) };
    delete req.session.rpending;
    // TODO: save discord.id <-> roblox.id in a DB and block one Roblox account on two Discords
    await giveDiscordPerks(req.session.discord.id, p.name);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Check failed, try again' }); }
});

// ---------- Роль и ник в Discord-сервере (нужен бот на сервере) ----------
async function giveDiscordPerks(discordId, robloxName) {
  if (!DISCORD_BOT_TOKEN || !GUILD_ID) return;
  const h = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
  const base = `https://discord.com/api/guilds/${GUILD_ID}/members/${discordId}`;
  await fetch(base, { method: 'PATCH', headers: h, body: JSON.stringify({ nick: robloxName }) });
  if (VERIFIED_ROLE_ID) await fetch(`${base}/roles/${VERIFIED_ROLE_ID}`, { method: 'PUT', headers: h });
}

app.listen(PORT, () => console.log('http://localhost:' + PORT));

// Запускаем Discord-бота в том же процессе (панель /verify-panel)
if (DISCORD_BOT_TOKEN) await import('./bot.js');
