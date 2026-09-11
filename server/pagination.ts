import type { Request } from "express";
export function listWindow(req: Request) {
  if (req.query.page === undefined && req.query.limit === undefined)
    return { limit: 2147483647, offset: 0, paged: false };
  const limit = Math.max(
    1,
    Math.min(200, Math.trunc(Number(req.query.limit)) || 50),
  );
  const page = Math.max(
    0,
    Math.min(100000, Math.trunc(Number(req.query.page)) || 0),
  );
  return { limit, offset: page * limit, paged: true };
}
