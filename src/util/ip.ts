import console from 'node:console';
import os from 'os';
import { Server as HttpServer } from 'http';

function getIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) {
      continue;
    }

    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }

  return addresses;
}

export function printListeningAddress(httpServer: HttpServer) {
  const addressInfo = httpServer.address();
  if (typeof addressInfo === 'string') {
    // pipe or UNIX socket
    console.log(`Server listening on ${addressInfo}`);
  } else if (addressInfo) {
    console.log('Server listening on:');
    console.log(`http://${addressInfo.address}:${addressInfo.port}`);
    console.log(`http://127.0.0.1:${addressInfo.port}`);
    console.log(`http://localhost:${addressInfo.port}`);
    for (const ipv4Address of getIPv4Addresses()) {
      console.log(`http://${ipv4Address}:${addressInfo.port}`);
    }
  }
}
