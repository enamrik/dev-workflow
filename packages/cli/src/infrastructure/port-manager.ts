import getPort from "get-port";

export async function findAvailablePort(): Promise<number> {
  // Find a random available port between 3000-9000
  const port = 3000 + Math.floor(Math.random() * 6000);
  return await getPort({ port });
}
