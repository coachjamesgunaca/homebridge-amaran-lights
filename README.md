# homebridge-amaran-lights

Homebridge platform plugin for exposing two amaran lights to Apple Home:

- amaran Ray 120c: on/off, brightness, color temperature, hue, saturation
- amaran Verge Max: on/off, brightness, color temperature

The plugin side is separated from the hardware transport, with a first-class `amaran-desktop` transport for the amaran Desktop API:

- a `mock` transport for Homebridge setup/testing
- an `amaran-desktop` transport for the local amaran Desktop API
- an `http` transport for custom bridge services
- model-specific color temperature ranges

## Install for development

```sh
npm install
npm run build
npm link
homebridge -I
```

Then install the linked plugin into your Homebridge environment:

```sh
npm link homebridge-amaran-lights
```

## Homebridge config

Desktop API mode points Homebridge at the amaran desktop service:

```json
{
  "platform": "AmaranLightsPlatform",
  "name": "Amaran Lights",
  "transport": {
    "type": "amaran-desktop",
    "webSocketUrl": "ws://127.0.0.1:12345",
    "apiSecretKeyEnv": "AMARAN_API_SECRET_KEY",
    "clientId": 1,
    "requestTimeoutMs": 5000,
    "debounceMs": 220
  },
  "lights": [
    {
      "id": "05010-ccdde1",
      "name": "Ray 120c",
      "model": "ray-120c"
    },
    {
      "id": "05010-ccdde2",
      "name": "Verge Max",
      "model": "verge-max"
    }
  ]
}
```

Use the amaran Desktop `node_id` for each `lights[].id`. You can get the IDs from the Desktop API `get_fixture_list` or `get_device_list` actions.

For the API secret key, prefer `apiSecretKeyEnv` so the key is read from the Homebridge process environment. A direct `apiSecretKey` field is also supported, but it will be stored in Homebridge config as plain text.

For local development:

```sh
export AMARAN_API_SECRET_KEY="your-amaran-desktop-api-secret"
```

Mock mode lets you check that both lights appear in Apple Home:

```json
{
  "platform": "AmaranLightsPlatform",
  "name": "Amaran Lights",
  "transport": {
    "type": "mock"
  },
  "lights": [
    {
      "id": "ray-120c",
      "name": "Ray 120c",
      "model": "ray-120c"
    },
    {
      "id": "verge-max",
      "name": "Verge Max",
      "model": "verge-max"
    }
  ]
}
```

## Desktop API mapping

The `amaran-desktop` transport connects to the local amaran Desktop WebSocket server. The documented default is `ws://127.0.0.1:12345`.

Every request includes:

- `version: 2`
- `type: "request"`
- `client_id`
- `request_id`
- `node_id`
- `action`
- a fresh `token`

The token is generated per request from your API secret key with AES-256-GCM. The plaintext is the current Unix timestamp in seconds, and the final token is `base64(iv + authTag + ciphertext)`.

HomeKit values are mapped to amaran actions:

- On: `set_sleep` with `sleep: false` for on and `sleep: true` for off
- Brightness: `set_intensity`, using amaran's `0-1000` intensity scale
- Color temperature: `set_cct`, using kelvin values
- Hue and saturation: `set_hsi`

State reads use `get_sleep`, `get_intensity`, `get_cct`, and, for color-capable lights, `get_hsi`. The transport also listens for Desktop API events such as `sleep_changed`, `intensity_changed`, `cct_changed`, and `hsi_changed` to keep its cache current.

## HTTP bridge contract

The generic `http` transport expects a local bridge to expose:

```http
GET /lights/:id
POST /lights/:id
```

`GET` returns the latest known state:

```json
{
  "on": true,
  "brightness": 75,
  "colorTemperatureKelvin": 5600,
  "hue": 220,
  "saturation": 35
}
```

`POST` accepts a partial update and returns the resulting state:

```json
{
  "brightness": 40,
  "colorTemperatureKelvin": 3200
}
```

All values are normalized for HomeKit:

- `brightness`: `1-100`
- `colorTemperatureKelvin`: Ray 120c `1800-20000`, Verge Max `2700-6500`
- `hue`: `0-360`
- `saturation`: `0-100`

## References

- Homebridge developer docs: https://developers.homebridge.io/
- amaran OpenAPI usage docs: https://tools.sidus.link/openapi/docs/usage
- amaran OpenAPI protocol docs: https://tools.sidus.link/openapi/docs/protocol
- amaran Ray 120c product page: https://amarancreators.com/pages/amaran-ray-120c
- amaran Verge Max product page: https://amarancreators.com/pages/amaran-verge-max
- amaran app download page: https://amarancreators.com/pages/amaran-app-download
