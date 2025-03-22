# Implementation Choices

- **Stack**: Used Node.js/Express (TypeScript)
  - **NestJS** would be preferred (if the project were to get any more complex):
    - Dependency injection
    - Expressive validators and configuration using decorators
  - **Rust** could be a good candidate (Performance and more explicit).
- **Package Manager**: `pnpm` for speed and reduced disk space usage (npm/yarn can still work)
- **Prettier**:
  - removes need to worry about "how does this look"
    - even if I disagree with some of the default rules
    - contributions all match the style automatically
- **ESLint**:
  - helps keep code cleaner and more consistent
  - prevents code smells
  - because nobody likes lint — especially in code (or belly buttons)
- **Authentication**:
  - Uses simple static tokens
    - Tokens are mapped to users via a static in-memory map
  - (Ideal) JWT token for authentication for speed and reduced load on a DB
    - Edge or early validation can be offloaded to either:
      - **AWS**: CloudFront + Lambda@Edge, or API Gateway + Authorizer
      - **Cloudflare**: Cloudflare Access (Zero Trust platform)
- **WebSocket Security**:
  - Token [JWT] Authentication happens during the `Upgrade`
  - UserId is matched the token and saved to the socket data
    - (Ideal) JWT would encode the `UserId` right into the JWT payload
  - only a single socket per `UserId` is allowed
    - new sockets will close existing ones
  - when user has exhausted there usage, the socket disconnects
    - usage tracked in static in-memory map
      - initial limits are set to 1000ms (so the e2e tests don't time out with default 5000ms settings)
      - (Ideal) redis or anything that can be load balanced / accessed concurrently / fast
  - TODO / not implemented:
    - mid session JWT validation via message
    - transcription queue
      - ~~limit number of transcriber threads/process~~
      - offloading data to temp files if queue is backed up
      - ~~prevent client from getting transcription results out of order~~
      - if packets don't have pauses or breaks at start/end then join them until one is found so words aren't missed
- **Misc**
  - Opaque/Tagged Types used for `UserId`
  - pLimit used in e2e test to limit max concurrency to 1
    - avoids address already in use
    - in memory usage table is effectively static/global
  - deserialization of messages should be validated via zod/myzod or similar

# Project Structure:

```
src/main             # bootstrap / main entry point
src/server/
├── index            # createServer entrypoint
├── controllers
│   └── usage
├── middleware
│   └── auth         # fake JWT validator
├── routes
│   ├── index        # /api/
│   └── usage        # /api/usage
├── services
│   ├── transcribe
│   └── usage
└── ws
    └── transcribe   # WebSocket server
```

# Installing

`pnpm install`

# Running

`pnpm start`
or
`pnpm tsx .`
or
`pnpm tsx src/main.ts`

# Demo

## Simple

`pnpm demo:simple`
or
`pnpm tsx src/demo-simple.ts`

The simple demo:

- creates the server
- connects 2 users to the wss
- user 1 sends 250ms worth of fake data to via ws sequentially until their usage limit is reached
- user 1 gets disconnected
- user 2 sends 1 packet maxing out their usage allocation in one-shot
- user 2 disconnects
- server shuts down

Authentication, concurrent users, and usage exhaustion enforcement - is tested in the [transcribe e2e test](./test/transcribe.e2e-spec.ts)

## Concurrent

`pnpm demo:concurrent`
or
`pnpm tsx src/demo-concurrent.ts`

The concurrent demo:

- increases max usage limits to 60s
- creates the server
- connects 2 users to the wss
- each user concurrently sends a random amount of bytes (16k - 160k)
- each user logs transcriptions as they receive them
- demo ends after both users are disconnected from exhausting their usage

# Tests

`pnpm test`
or
`pnpm jest`
