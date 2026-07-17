export async function GET() {
  const base = process.env.CMDB_API_BASE_URL;
  if (!base) return Response.json({ host: null });
  try {
    return Response.json({ host: new URL(base).hostname });
  } catch {
    return Response.json({ host: null });
  }
}
