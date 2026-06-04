export function clampBuySizeSol(requested, maxBuySol) {
  const req = Number(requested);
  const max = Number(maxBuySol);
  if (!Number.isFinite(req) || req <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return Math.min(req, max);
}

export function solToLamports(sol) {
  return Math.floor(Number(sol || 0) * 1_000_000_000);
}
