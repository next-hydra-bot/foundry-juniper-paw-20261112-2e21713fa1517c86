export const PURCHASING_CONTEXT_COOKIE_NAME = "purchasing-context";
export const PURCHASING_CONTEXT_COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 90,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
