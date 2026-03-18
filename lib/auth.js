import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "talli_auth";
const AUTH_STATE_COOKIE_NAME = "talli_auth_state";
const ONE_DAY_IN_SECONDS = 60 * 60 * 24;
const THIRTY_DAYS_IN_SECONDS = ONE_DAY_IN_SECONDS * 30;

function getCookieSecret() {
  return process.env.AUTH_COOKIE_SECRET ?? null;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value) {
  const secret = getCookieSecret();

  if (!secret) {
    return null;
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

function toSignedToken(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encodedPayload);

  if (!signature) {
    throw new Error("Missing AUTH_COOKIE_SECRET environment variable.");
  }

  return `${encodedPayload}.${signature}`;
}

function fromSignedToken(token) {
  if (typeof token !== "string") {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);

  if (!expectedSignature) {
    return null;
  }

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(encodedPayload));
  } catch (error) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie;

  if (typeof header !== "string" || header.trim() === "") {
    return {};
  }

  return header.split(";").reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }

    return cookies;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push(`Path=${options.path ?? "/"}`);
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");

  if (!current) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [current, cookieValue]);
}

function isSecureRequest(req) {
  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const host = req.headers?.host ?? "";

  return req.secure || forwardedProto === "https" || (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
}

function getRequestOrigin(req) {
  const forwardedProto = req.headers?.["x-forwarded-proto"];
  const protocol = forwardedProto || (isSecureRequest(req) ? "https" : "http");
  const host = req.headers?.host;

  if (!host) {
    throw new Error("Unable to determine request host.");
  }

  return `${protocol}://${host}`;
}

function getQueryParam(req, name) {
  if (typeof req.query?.[name] === "string") {
    return req.query[name];
  }

  if (typeof req.url === "string") {
    return new URL(req.url, "http://localhost").searchParams.get(name);
  }

  return null;
}

function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  };
}

export function isGoogleAuthConfigured() {
  const config = getGoogleConfig();
  return Boolean(config.clientId && config.clientSecret && getCookieSecret());
}

function getGoogleRedirectUri(req) {
  const configuredRedirectUri = getGoogleConfig().redirectUri;

  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  return `${getRequestOrigin(req)}/api/auth?action=google-callback`;
}

function getGoogleAuthUrl(req, state) {
  const { clientId } = getGoogleConfig();

  if (!clientId) {
    throw new Error("Missing GOOGLE_CLIENT_ID environment variable.");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getGoogleRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForTokens(req, code) {
  const { clientId, clientSecret } = getGoogleConfig();

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth environment variables.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  return response.json();
}

async function fetchGoogleUser(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google userinfo request failed: ${errorText}`);
  }

  return response.json();
}

function setAuthCookie(req, res, user) {
  appendSetCookie(
    res,
    serializeCookie(
      AUTH_COOKIE_NAME,
      toSignedToken({
        sub: user.sub,
        email: user.email,
        name: user.name,
        picture: user.picture,
      }),
      {
        maxAge: THIRTY_DAYS_IN_SECONDS,
        secure: isSecureRequest(req),
      }
    )
  );
}

function clearCookie(req, res, name) {
  appendSetCookie(
    res,
    serializeCookie(name, "", {
      maxAge: 0,
      secure: isSecureRequest(req),
    })
  );
}

function setStateCookie(req, res, state) {
  appendSetCookie(
    res,
    serializeCookie(AUTH_STATE_COOKIE_NAME, toSignedToken({ state }), {
      maxAge: ONE_DAY_IN_SECONDS,
      secure: isSecureRequest(req),
    })
  );
}

function getStateFromCookie(req) {
  const cookies = parseCookies(req);
  const payload = fromSignedToken(cookies[AUTH_STATE_COOKIE_NAME]);
  return typeof payload?.state === "string" ? payload.state : null;
}

export function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const payload = fromSignedToken(cookies[AUTH_COOKIE_NAME]);

  if (!payload || typeof payload.sub !== "string") {
    return null;
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}

export function resolveOwnerId(req, fallbackSessionId) {
  const user = getAuthenticatedUser(req);

  if (user) {
    return `google:${user.sub}`;
  }

  if (typeof fallbackSessionId !== "string") {
    return null;
  }

  const sessionId = fallbackSessionId.trim();
  return sessionId !== "" ? sessionId : null;
}

export async function handleAuthRequest(req, res) {
  try {
    const action = getQueryParam(req, "action") ?? "me";

    if (req.method === "GET" && action === "me") {
      return res.status(200).json({
        user: getAuthenticatedUser(req),
        googleConfigured: isGoogleAuthConfigured(),
      });
    }

    if (req.method === "GET" && action === "google-start") {
      if (!isGoogleAuthConfigured()) {
        return res.status(500).json({ error: "Google OAuth is not configured." });
      }

      const state = randomUUID();
      setStateCookie(req, res, state);
      return res.redirect(getGoogleAuthUrl(req, state));
    }

    if (req.method === "GET" && action === "google-callback") {
      const code = getQueryParam(req, "code");
      const state = getQueryParam(req, "state");
      const expectedState = getStateFromCookie(req);

      clearCookie(req, res, AUTH_STATE_COOKIE_NAME);

      if (!code || !state || !expectedState || state !== expectedState) {
        return res.redirect("/?authError=state_mismatch");
      }

      const tokens = await exchangeCodeForTokens(req, code);
      const user = await fetchGoogleUser(tokens.access_token);
      setAuthCookie(req, res, user);
      return res.redirect("/");
    }

    if (req.method === "POST" && action === "logout") {
      clearCookie(req, res, AUTH_COOKIE_NAME);
      clearCookie(req, res, AUTH_STATE_COOKIE_NAME);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("Auth error:", error);

    if (req.method === "GET") {
      return res.redirect("/?authError=oauth_failed");
    }

    return res.status(500).json({ error: "Server error." });
  }
}
