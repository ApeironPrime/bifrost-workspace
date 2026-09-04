import jwt from "jsonwebtoken";

export type AuthUser = {
  id: string;
  email: string;
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET chưa được cấu hình.");
  return secret;
}

export function createAccessToken(user: AuthUser) {
  return jwt.sign({ email: user.email }, jwtSecret(), {
    subject: user.id,
    expiresIn: "7d",
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, jwtSecret());
  if (typeof payload === "string" || !payload.sub || typeof payload.email !== "string") {
    throw new Error("Token không hợp lệ.");
  }
  return { id: payload.sub, email: payload.email };
}
