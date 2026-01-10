import { loadConfig, saveConfig } from '../config/config.js';
import open from 'open';

interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface TokenResponse {
  accessToken: string;
  userId: string;
  email: string;
  deviceId: string;
}

interface PendingResponse {
  status: 'pending';
  error?: string;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const config = loadConfig();
  const response = await fetch(`${config.apiUrl}/api/v1/auth/device`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.statusText}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

export async function pollDeviceToken(deviceCode: string): Promise<TokenResponse | PendingResponse> {
  const config = loadConfig();
  const os = await import('node:os');
  const platform = `${os.platform()}-${os.arch()}`;
  const hostname = os.hostname();

  const response = await fetch(`${config.apiUrl}/api/v1/auth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceCode,
      deviceName: hostname,
      platform,
    }),
  });

  if (response.status === 202) {
    const data = await response.json() as { status: string; error?: string };
    return { status: 'pending', error: data.error };
  }

  if (!response.ok) {
    const data = await response.json() as { error: string };
    throw new Error(data.error || 'Authentication failed');
  }

  return response.json() as Promise<TokenResponse>;
}

export async function login(): Promise<{ userId: string; email: string }> {
  console.log('Starting device authentication...\n');

  const deviceCode = await requestDeviceCode();

  console.log(`Opening browser to login...\n`);
  console.log(`  ${deviceCode.verificationUriComplete}\n`);
  console.log(`Or go to ${deviceCode.verificationUri} and enter code: ${deviceCode.userCode}\n`);
  
  // Auto-open the browser
  try {
    await open(deviceCode.verificationUriComplete);
  } catch {
    // Silently fail if browser can't be opened - URL is displayed above
  }
  
  console.log('Waiting for authentication...');

  // Poll for token
  const startTime = Date.now();
  const timeoutMs = deviceCode.expiresIn * 1000;
  const intervalMs = (deviceCode.interval || 5) * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(intervalMs);

    const result = await pollDeviceToken(deviceCode.deviceCode);

    if ('status' in result && result.status === 'pending') {
      process.stdout.write('.');
      continue;
    }

    // Success
    const tokenResult = result as TokenResponse;
    saveConfig({
      accessToken: tokenResult.accessToken,
      userId: tokenResult.userId,
      deviceId: tokenResult.deviceId,
      email: tokenResult.email,
    });

    console.log(`\n\nLogged in as ${tokenResult.email}`);
    console.log(`Device ID: ${tokenResult.deviceId}`);

    return { userId: tokenResult.userId, email: tokenResult.email };
  }

  throw new Error('Authentication timed out');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
