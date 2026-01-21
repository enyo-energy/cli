# CLI Service Documentation

The CLI Service provides a WebSocket-based command interface for interacting with the device. All communication is done through WebSocket messages with structured JSON payloads.

## Connection

Connect to the CLI service via WebSocket at the `/cli` endpoint.

**Requirements:**
- Authentication header: `Authorization: Bearer <debug-token>`
- Optional: `package-name` header for package-specific operations

**Example:**
```javascript
const ws = new WebSocket('ws://localhost:3000/cli', {
    headers: {
        'Authorization': 'Bearer your-debug-token',
        'package-name': 'my-package'
    }
});
```

## Message Format

All messages follow this structure:

**Request:**
```json
{
    "command": "<command-type>",
    "payload": { /* command-specific data */ }
}
```

**Response:**
```json
{
    "type": "<response-type>",
    "status": "success|error",
    "message": "Response message",
    "data": { /* response-specific data */ },
    "timestamp": "ISO timestamp (for logs)",
    "level": "info|debug|error|warn (for logs)"
}
```

## Available Commands

### 1. Ping
Test the connection to the CLI service.

**Request:**
```json
{
    "command": "ping"
}
```

**Response:**
```json
{
    "type": "pong"
}
```

### 2. Subscribe to Logs
Subscribe to log messages from packages.

**Request:**
```json
{
    "command": "subscribe-logs"
}
```

**Response:**
```json
{
    "type": "log",
    "status": "success",
    "message": "Subscribed to logs successfully"
}
```

**Log Messages (after subscription):**
```json
{
    "type": "log",
    "timestamp": "2024-01-18T10:00:00.000Z",
    "level": "info",
    "message": "Your log message here"
}
```

### 3. Device Information
Get information about the device and connected packages.

**Request:**
```json
{
    "command": "info"
}
```

**Response:**
```json
{
    "type": "info-response",
    "status": "success",
    "data": {
        "deviceId": "device-123",
        "debugModeEnabled": true,
        "connectedPackages": [
            {
                "name": "dev-my-package",
                "status": "Running"
            }
        ],
        "uptime": "3600",
        "version": "v18.0.0"
    }
}
```

### 4. Mock Network Device
Create a mock network device for testing purposes.

**Request:**
```json
{
    "command": "mock-network-device",
    "payload": {
        "ports": [80, 443, 8080],
        "ipAddress": "192.168.1.100"
    }
}
```

**Response:**
```json
{
    "type": "mock-network-device-response",
    "status": "success",
    "message": "Mock network device created with IP 192.168.1.100 and 3 ports",
    "data": {
        "deviceId": "mock-device-123"
    }
}
```

**Payload Fields:**
- `ports` (required): Array of port numbers to expose
- `ipAddress` (optional): IP address for the device (defaults to 172.17.0.1)

### 5. Trigger Device Scan
Scan for network devices.

**Request:**
```json
{
    "command": "trigger-device-scan"
}
```

**Response:**
```json
{
    "type": "device-scan-response",
    "status": "success",
    "message": "Device scan completed successfully",
    "data": {
        "devicesFound": 3,
        "devices": [
            {
                "id": "device-1",
                "ipAddress": "192.168.1.101",
                "hostname": "smart-meter"
            },
            {
                "id": "device-2",
                "ipAddress": "192.168.1.102",
                "hostname": "heat-pump"
            }
        ]
    }
}
```

### 6. Install Development Package
Install a development package on the device.

**Request:**
```json
{
    "command": "install-dev-package",
    "payload": {
        "packageId": "my-package-id",
        "packageName": "my-package",
        "sdkVersion": "1.0.0",
        "packageVersion": 1,
        "packageBundle": "<base64-encoded-tar.gz>",
        "debugToken": "your-debug-token",
        "permissions": ["READ_ENERGY_DATA", "CONTROL_DEVICES"],
        "options": {
            "autoStart": true
        }
    }
}
```

**Response:**
```json
{
    "type": "install-dev-package-response",
    "status": "success",
    "message": "Dev package installation request accepted",
    "data": {
        "packageId": "dev-my-package-id",
        "packageName": "dev-my-package",
        "packageVersion": 1
    }
}
```

**Payload Fields:**
- `packageId` (required): Unique identifier for the package
- `packageName` (required): Name of the package
- `sdkVersion` (required): SDK version used by the package
- `packageVersion` (required): Version number of the package
- `packageBundle` (required): Base64-encoded tar.gz bundle containing the package
- `debugToken` (required): Debug token for authentication
- `permissions` (required): Array of permission types the package requires
- `options` (optional): Additional package configuration options

## Error Handling

When an error occurs, the response will have the following format:

```json
{
    "type": "error",
    "status": "error",
    "message": "Error description"
}
```

Common error scenarios:
- Invalid authentication token
- Missing or invalid payload data
- Device not in debug mode (for certain commands)
- Internal service errors

## Example Usage

### JavaScript/Node.js
```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/cli', {
    headers: {
        'Authorization': 'Bearer your-debug-token',
        'package-name': 'my-package'
    }
});

ws.on('open', () => {
    // Subscribe to logs
    ws.send(JSON.stringify({
        command: 'subscribe-logs'
    }));

    // Get device info
    ws.send(JSON.stringify({
        command: 'info'
    }));
});

ws.on('message', (data) => {
    const response = JSON.parse(data.toString());
    console.log('Received:', response);
});
```

### Python
```python
import websocket
import json

def on_message(ws, message):
    response = json.loads(message)
    print("Received:", response)

def on_open(ws):
    # Subscribe to logs
    ws.send(json.dumps({
        'command': 'subscribe-logs'
    }))

headers = {
    'Authorization': 'Bearer your-debug-token',
    'package-name': 'my-package'
}

ws = websocket.WebSocketApp(
    "ws://localhost:3000/cli",
    header=headers,
    on_message=on_message,
    on_open=on_open
)

ws.run_forever()
```

## Security

- All CLI operations require a valid debug token
- Debug mode must be enabled on the device for most operations
- Package installation operations have additional authentication checks
- WebSocket connections are automatically terminated for invalid authentication