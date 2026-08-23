/* =========================================
   Yalca Portal — configuração do Cloudflare Turnstile
   Crie um site gratuito em:
   https://dash.cloudflare.com/?to=/:account/turnstile
   e cole aqui o SITE KEY (a Secret Key vai só no painel do
   Supabase, em Authentication → Attack Protection — nunca aqui).
   ========================================= */

const TURNSTILE_SITE_KEY = 'COLE_AQUI_SEU_SITE_KEY';

const yalcaTurnstileConfigured = !TURNSTILE_SITE_KEY.startsWith('COLE_AQUI');
