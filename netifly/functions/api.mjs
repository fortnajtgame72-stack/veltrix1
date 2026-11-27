import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const config = { path: "/api/*" };
const E = process.env;
const db = createClient(E.SUPABASE_URL, E.SUPABASE_SERVICE_KEY);
const s3 = new S3Client({ region: "auto", endpoint: `https://${E.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: E.R2_ACCESS_KEY_ID, secretAccessKey: E.R2_SECRET_ACCESS_KEY } });
const ADMINS = (E.ADMIN_IDS || "1505850027220668447").split(",").map(s => s.trim());
const MAX = 800 * 1024 * 1024;
const J = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", ...h } });
const hmac = b => crypto.createHmac("sha256", E.SESSION_SECRET).update(b).digest("base64url");
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString("base64url"); return b + "." + hmac(b); };
const verify = t => { try { const [b, m] = (t || "").split("."); if (m !== hmac(b)) return null;
  const p = JSON.parse(Buffer.from(b, "base64url")); return p.exp > Date.now() ? p : null; } catch { return null; } };
const cookie = (r, n) => (r.headers.get("cookie") || "").split(/;\s*/).map(c => c.split("=")).find(c => c[0] === n)?.[1];
const setC = (n, v, age) => `${n}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const banned = async id => !!(await db.from("blacklist").select("discord_id").eq("discord_id", id).maybeSingle()).data;
const pub = ({ file_key, ...s }) => s;

export default async (req) => {
  const url = new URL(req.url), origin = url.origin;
  const p = url.pathname.replace(/^\/api\//, "").split("/").filter(Boolean);
  const m = req.method, route = p.join("/");

  if (route === "auth/login") {
    const st = crypto.randomUUID();
    const q = new URLSearchParams({ client_id: E.DISCORD_CLIENT_ID, redirect_uri: origin + "/api/auth/callback",
      response_type: "code", scope: "identify", prompt: "consent", state: st });
    return new Response(null, { status: 302, headers: { location: "https://discord.com/oauth2/authorize?" + q, "set-cookie": setC("vxs", st, 600) } });
  }
  if (route === "auth/callback") {
    if (url.searchParams.get("state") !== cookie(req, "vxs")) return new Response("Neispravan state", { status: 400 });
    const t = await (await fetch("https://discord.com/api/oauth2/token", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: E.DISCORD_CLIENT_ID, client_secret: E.DISCORD_CLIENT_SECRET, grant_type: "authorization_code",
        code: url.searchParams.get("code") || "", redirect_uri: origin + "/api/auth/callback" }) })).json();
    if (!t.access_token) return new Response("Discord login nije uspeo", { status: 400 });
    const u = await (await fetch("https://discord.com/api/users/@me", { headers: { authorization: "Bearer " + t.access_token } })).json();
    const sess = sign({ id: u.id, name: u.global_name || u.username, avatar: u.avatar, exp: Date.now() + 7 * 864e5 });
    const h = new Headers({ location: "/" }); h.append("set-cookie", setC("vx", sess, 604800)); h.append("set-cookie", setC("vxs", "", 0));
    return new Response(null, { status: 302, headers: h });
  }
  if (route === "auth/logout")
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": setC("vx", "", 0) } });
  if (route === "settings" && m === "GET")
    return J((await db.from("settings").select("value").eq("key", "site").maybeSingle()).data?.value || {});

  const me = verify(cookie(req, "vx"));
  if (route === "me") {
    if (!me) return J({ user: null });
    return J({ user: { id: me.id, name: me.name, avatar: me.avatar }, admin: ADMINS.includes(me.id), banned: await banned(me.id) });
  }
  if (!me) return J({ error: "Nisi ulogovan" }, 401);
  if (await banned(me.id)) return J({ error: "Blacklistovan si" }, 403);
  const admin = ADMINS.includes(me.id);

  if (route === "scripts" && m === "GET") {
    const { data } = await db.from("scripts").select("*").order("created_at", { ascending: false });
    return J((data || []).map(pub));
  }
  if (p[0] === "scripts" && p[1] && m === "GET") {
    const { data } = await db.from("scripts").select("*").eq("id", p[1]).maybeSingle();
    return data ? J(pub(data)) : J({ error: "Ne postoji" }, 404);
  }
  if (p[0] === "download" && p[1]) {
    const { data: s } = await db.from("scripts").select("*").eq("id", p[1]).maybeSingle();
    if (!s?.file_key) return J({ error: "Nema fajla" }, 404);
    await db.from("scripts").update({ downloads: (s.downloads || 0) + 1 }).eq("id", s.id);
    const link = await getSignedUrl(s3, new GetObjectCommand({ Bucket: E.R2_BUCKET, Key: s.file_key,
      ResponseContentDisposition: `attachment; filename="${(s.file_name || "script.zip").replace(/"/g, "")}"` }), { expiresIn: 300 });
    return new Response(null, { status: 302, headers: { location: link } });
  }

  if (p[0] !== "admin") return J({ error: "Nepoznato" }, 404);
  if (!admin) return J({ error: "Samo admin" }, 403);
  const body = ["POST", "PUT"].includes(m) ? await req.json().catch(() => ({})) : {};

  if (route === "admin/upload-url") {
    const isFile = body.kind === "file", name = String(body.name || "f").replace(/[^\w.\-]/g, "_");
    if (isFile && !/\.(zip|rar)$/i.test(name)) return J({ error: "Samo .zip ili .rar" }, 400);
    if (!isFile && !/\.(png|jpe?g|webp|gif)$/i.test(name)) return J({ error: "Samo slike" }, 400);
    if (isFile && !(body.size > 0 && body.size <= MAX)) return J({ error: "Maksimum 800MB" }, 400);
    if (!isFile && body.size > 15 * 1024 * 1024) return J({ error: "Slika max 15MB" }, 400);
    const key = `${isFile ? "files" : "img"}/${crypto.randomUUID()}-${name}`;
    const put = await getSignedUrl(s3, new PutObjectCommand({ Bucket: E.R2_BUCKET, Key: key, ContentType: body.type || "application/octet-stream" }), { expiresIn: 3600 });
    return J({ url: put, key, publicUrl: (E.R2_PUBLIC_URL || "").replace(/\/$/, "") + "/" + key });
  }
  if (route === "admin/scripts" && m === "POST") {
    const f = ["title", "description", "version", "category", "changelog", "cover", "images", "file_key", "file_name", "file_size"];
    const row = Object.fromEntries(f.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
    if (!row.title) return J({ error: "Naslov je obavezan" }, 400);
    if (row.category !== undefined) row.category = String(row.category).trim().slice(0, 60) || "Ostalo";
    const r = body.id ? await db.from("scripts").update(row).eq("id", body.id).select().single() : await db.from("scripts").insert(row).select().single();
    return r.error ? J({ error: r.error.message }, 400) : J(pub(r.data));
  }
  if (p[1] === "scripts" && p[2] && m === "DELETE") {
    const { data: s } = await db.from("scripts").select("file_key").eq("id", p[2]).maybeSingle();
    if (s?.file_key) await s3.send(new DeleteObjectCommand({ Bucket: E.R2_BUCKET, Key: s.file_key })).catch(() => {});
    await db.from("scripts").delete().eq("id", p[2]);
    return J({ ok: true });
  }
  if (route === "admin/settings" && m === "POST") {
    await db.from("settings").upsert({ key: "site", value: body });
    return J({ ok: true });
  }
  if (route === "admin/blacklist") {
    if (m === "GET") return J((await db.from("blacklist").select("*").order("created_at", { ascending: false })).data || []);
    if (m === "POST") {
      if (!/^\d{15,22}$/.test(body.discord_id || "")) return J({ error: "Neispravan Discord ID" }, 400);
      if (ADMINS.includes(body.discord_id)) return J({ error: "Ne mozes banovati admina" }, 400);
      await db.from("blacklist").upsert({ discord_id: body.discord_id, reason: body.reason || "" });
      return J({ ok: true });
    }
    if (m === "DELETE") { await db.from("blacklist").delete().eq("discord_id", url.searchParams.get("id")); return J({ ok: true }); }
  }
  return J({ error: "Nepoznato" }, 404);
};
