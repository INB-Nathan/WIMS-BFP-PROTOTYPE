export function extractRegionalIncidentRouteId(pathname: string | null | undefined): string | undefined {
  return pathname?.match(/\/dashboard\/regional\/incidents\/([^/?#]+)/)?.[1];
}
