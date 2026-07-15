# Вход по логину и паролю

Эта функция использует Supabase Auth только как безопасное хранилище паролей и сессий. Пользователь не видит и не вводит email.

## Один раз в терминале

1. Установите Supabase CLI и войдите: `supabase login`.
2. В папке проекта выполните:

```powershell
supabase link --project-ref zgrkiaslacsozzaqhdjk
supabase secrets set AUTH_EMAIL_INBOX=your-gmail-address@gmail.com
supabase functions deploy username-auth
```

`AUTH_EMAIL_INBOX` — технический адрес владельца проекта. Письма на него не отправляются. Для каждого логина функция создаёт отдельный плюс-адрес этого inbox, например `your-gmail-address+osirium-tetrix@gmail.com`.

## Обязательно перед публикацией

Включите CAPTCHA в Authentication → Attack Protection и добавьте ограничение частоты запросов к Edge Function через API gateway/WAF. Иначе злоумышленник сможет массово пытаться регистрировать логины или подбирать пароли.
