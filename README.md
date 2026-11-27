# Veltrix Development – uputstvo

## 1. Supabase
Napravi projekat, u SQL Editor nalepi `supabase.sql` i pokreni. Iz Settings > API uzmi URL i **service_role** key.

## 2. Cloudflare R2
Napravi bucket. Uključi javni pristup (r2.dev ili svoj domen) – to je R2_PUBLIC_URL (koristi se za slike).
Napravi API token (Object Read & Write). U bucket > Settings > CORS dodaj:
[{"AllowedOrigins":["https://TVOJ-SAJT.netlify.app"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["*"]}]

## 3. Discord
Developer Portal > New Application > OAuth2 > Redirects: `https://TVOJ-SAJT.netlify.app/api/auth/callback`
Uzmi Client ID i Client Secret.

## 4. Netlify > Site settings > Environment variables
DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET (dugačak random string),
SUPABASE_URL, SUPABASE_SERVICE_KEY,
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL,
ADMIN_IDS (opciono, zarezom odvojeno; podrazumevano je tvoj ID 1505850027220668447)

**Važno za upload grešku:** U Cloudflare R2 > tvoj bucket > Settings > CORS policy dodaj (zameni domen stvarnim domenom sajta):
```json
[{"AllowedOrigins":["https://TVOJ-SAJT.netlify.app"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```
Bez `PUT` i odgovarajućeg `AllowedOrigins`, browser blokira upload iako je fajl ispravan. R2 token mora imati Object Read & Write.

Ako već imaš postojeću bazu, pokreni i novu SQL migraciju iz `supabase.sql` (dodaje `category` kolonu bez brisanja skripti).

## 5. Deploy
Poveži GitHub repo sa ovim folderom (ili Netlify CLI: `netlify deploy --prod`). Ne radi drag-and-drop, jer funkcije traže build.

## Globalna blacklista
Na svaki novi sajt stavi isti SUPABASE_URL i SUPABASE_SERVICE_KEY i isti `api.mjs`. Ban važi svuda.
