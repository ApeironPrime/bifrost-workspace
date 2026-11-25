import jwt from "jsonwebtoken";
import { getJwtSecret } from "./auth.js";

export type OAuthProvider = "google" | "github";

export interface OAuthStatePayload {
  provider: OAuthProvider;
  nonce: string;
  inviteToken?: string;
}

export interface OAuthUserProfile {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export const OAUTH_NONCE_COOKIE_NAME = "bifrost_oauth_nonce";

export function getConfiguredOAuthProviders(env: NodeJS.ProcessEnv = process.env): {
  google: boolean;
  github: boolean;
} {
  return {
    google: Boolean(
      env.GOOGLE_CLIENT_ID?.trim() &&
        env.GOOGLE_CLIENT_SECRET?.trim() &&
        env.GOOGLE_REDIRECT_URI?.trim(),
    ),
    github: Boolean(
      env.GITHUB_CLIENT_ID?.trim() &&
        env.GITHUB_CLIENT_SECRET?.trim() &&
        env.GITHUB_REDIRECT_URI?.trim(),
    ),
  };
}

export function createOAuthStateToken(payload: OAuthStatePayload): string {
  return jwt.sign({ ...payload, purpose: "oauth_state" }, getJwtSecret(), {
    expiresIn: "10m",
  });
}

export function verifyOAuthStateToken(token: string): OAuthStatePayload {
  const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & Partial<OAuthStatePayload>;
  if (
    decoded.purpose !== "oauth_state" ||
    (decoded.provider !== "google" && decoded.provider !== "github") ||
    typeof decoded.nonce !== "string" ||
    !decoded.nonce
  ) {
    throw new Error("OAuth state token không hợp lệ.");
  }
  return {
    provider: decoded.provider,
    nonce: decoded.nonce,
    inviteToken: typeof decoded.inviteToken === "string" ? decoded.inviteToken : undefined,
  };
}

export function buildOAuthAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (provider === "google") {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
    if (!clientId || !redirectUri) return null;
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
  }

  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const redirectUri = env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${query.toString()}`;
}

export async function exchangeOAuthCodeForProfile(
  provider: OAuthProvider,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthUserProfile> {
  if (provider === "google") {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Google OAuth2 chưa được cấu hình.");
    }

    const tokenRes = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      throw new Error("Không thể trao đổi mã Google OAuth2.");
    }
    const tokenBody = (await tokenRes.json()) as { access_token?: string };
    if (!tokenBody.access_token) {
      throw new Error("Google không trả về access token.");
    }

    const userRes = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userRes.ok) {
      throw new Error("Không thể lấy hồ sơ người dùng từ Google.");
    }
    const profile = (await userRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      email_verified?: boolean;
    };
    if (!profile.sub || !profile.email) {
      throw new Error("Tài khoản Google không cung cấp email.");
    }
    return {
      provider: "google",
      providerAccountId: String(profile.sub),
      email: profile.email.toLowerCase(),
      name: profile.name?.trim() || profile.email.split("@")[0] || "Bifrost User",
      emailVerified: Boolean(profile.email_verified),
    };
  }

  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = env.GITHUB_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("GitHub OAuth2 chưa được cấu hình.");
  }

  const tokenRes = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error("Không thể trao đổi mã GitHub OAuth2.");
  }
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new Error("GitHub không trả về access token.");
  }

  const ghHeaders = {
    Authorization: `Bearer ${tokenBody.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Bifrost-Workspace",
  };

  const userRes = await fetchImpl("https://api.github.com/user", { headers: ghHeaders });
  if (!userRes.ok) {
    throw new Error("Không thể lấy hồ sơ người dùng từ GitHub.");
  }
  const ghUser = (await userRes.json()) as {
    id?: number | string;
    login?: string;
    name?: string | null;
    email?: string | null;
  };
  if (!ghUser.id) {
    throw new Error("GitHub không trả về ID tài khoản.");
  }

  let email = ghUser.email?.trim().toLowerCase() ?? "";
  let emailVerified = Boolean(email);
  if (!email) {
    const emailsRes = await fetchImpl("https://api.github.com/user/emails", { headers: ghHeaders });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const best =
        emails.find((entry) => entry.primary && entry.verified) ??
        emails.find((entry) => entry.verified) ??
        emails[0];
      if (best?.email) {
        email = best.email.toLowerCase();
        emailVerified = Boolean(best.verified);
      }
    }
  }

  if (!email) {
    throw new Error("Tài khoản GitHub không có email khả dụng.");
  }

  return {
    provider: "github",
    providerAccountId: String(ghUser.id),
    email,
    name: ghUser.name?.trim() || ghUser.login?.trim() || email.split("@")[0] || "Bifrost User",
    emailVerified,
  };
}
