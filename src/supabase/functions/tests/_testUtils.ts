// supabase/functions/tests/_testUtils.ts
export function buildFakeJwt(userId: string): string {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = { sub: userId };
    const encode = (obj: unknown) =>
        btoa(JSON.stringify(obj))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", "");
    return `${encode(header)}.${encode(payload)}.signature`;
}
