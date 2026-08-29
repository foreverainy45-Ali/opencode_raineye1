import { basicAuthorization } from "../shared/endpoint";

export function createAuthenticatedFetch(password?: string): typeof fetch {
  if (!password) return fetch;
  const authorization = basicAuthorization(password);
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) headers.set("authorization", authorization);
    return await fetch(input, { ...init, headers });
  };
}
