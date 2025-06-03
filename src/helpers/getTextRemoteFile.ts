import { requestUrl } from 'obsidian';

export async function getTextRemoteFile(
  url: string, 
  headers: Record<string, string> = {},
): Promise<string> {
  const response = await requestUrl({
    url: url,
    method: 'GET',
    headers: {
      'Accept': '*/*',
      ...headers
    }
  });
  return response.text;
}
